// TabShell: draws ghosts and the HUD, owns Tab/Esc, reads Terminal, activates apps.
//   TabShell                       run (connects to ws://127.0.0.1:7800)
//   TabShell --selftest            draw every ghost kind at fixed rects, normal and high contrast
//   TabShell --dump                print one Terminal snapshot as JSON and exit
//   TabShell --render out.png      render the selftest ghosts offscreen to a PNG (no permissions needed); --bg img.png, --dark
//   flags: --high-contrast, --hub ws://host:port
import AppKit
import ApplicationServices

setvbuf(stdout, nil, _IOLBF, 0)
let args = CommandLine.arguments
let selfBundleId = "dev.tab.shell"

func flagValue(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

// MARK: - --dump

if args.contains("--dump") {
    let running = NSWorkspace.shared.runningApplications.filter { terminalApps.contains($0.bundleIdentifier ?? "") }
    let front = NSWorkspace.shared.frontmostApplication
    let pick = running.first { $0.processIdentifier == front?.processIdentifier } ?? running.first
    var report: [String: Any] = ["axTrusted": AXIsProcessTrusted(), "frontmost": front?.bundleIdentifier ?? ""]
    if let app = pick, let bid = app.bundleIdentifier {
        report["app"] = bid
        switch TerminalReader.snapshot(pid: app.processIdentifier, bundleId: bid) {
        case .success(let s):
            report["ok"] = true
            report["path"] = s.path
            report["lineCount"] = s.lines.count
            let st = TerminalReader.state(s, seq: 1)
            report["state"] = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(st)))
        case .failure(let e):
            report["ok"] = false
            report["error"] = e.description
        }
    } else {
        report["ok"] = false
        report["error"] = "neither Terminal nor iTerm2 is running"
    }
    let data = try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    print(String(decoding: data, as: UTF8.self))
    exit(report["ok"] as? Bool == true ? 0 : 1)
}

// MARK: - App

final class Shell: NSObject, InputTapDelegate {
    let overlay: Overlay
    let hud: HUD
    let tap = InputTap()
    let hub: HubClient
    let terminal = TerminalPoller()
    private var lastHud = Hud()
    private var statusItem: NSStatusItem?
    private var showHudItem: NSMenuItem?
    private var contrastItem: NSMenuItem?

    init(hubURL: URL, highContrast: Bool) {
        overlay = Overlay(highContrast: highContrast)
        hud = HUD()
        hub = HubClient(url: hubURL)
        super.init()
        hud.setHighContrast(highContrast)
        hud.onClick = { [weak self] item in self?.hudClicked(item) }
        tap.delegate = self
        hub.onMessage = { [weak self] m in self?.handle(m) }
        hub.onConnect = { [weak self] in
            self?.hud.setConnected(true)
            self?.reportFrontmost(NSWorkspace.shared.frontmostApplication)
        }
        terminal.onState = { [weak self] s in self?.hub.send(.state(s)) }
    }

    func start() {
        if !AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) {
            log("ax: not trusted yet; grant Accessibility to TabShell in System Settings → Privacy & Security")
        }
        startTapWhenTrusted()
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(appActivated(_:)),
                                                          name: NSWorkspace.didActivateApplicationNotification, object: nil)
        terminal.setFrontmost(NSWorkspace.shared.frontmostApplication)
        hub.start()
        setUpMenuBar()
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.checkHubShown() }
    }

    // MARK: menu bar item (show/hide and reset the HUD, high contrast, quit)

    private func setUpMenuBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "⇥"
        item.button?.toolTip = "Tab"
        let menu = NSMenu()
        let show = NSMenuItem(title: "Show HUD", action: #selector(toggleHud), keyEquivalent: "")
        show.target = self
        menu.addItem(show)
        let reset = NSMenuItem(title: "Reset HUD Position", action: #selector(resetHud), keyEquivalent: "")
        reset.target = self
        menu.addItem(reset)
        let hc = NSMenuItem(title: "High Contrast", action: #selector(toggleContrast), keyEquivalent: "")
        hc.target = self
        menu.addItem(hc)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit TabShell", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
        showHudItem = show
        contrastItem = hc
        refreshMenu()
    }

    private func refreshMenu() {
        showHudItem?.state = hud.isVisible ? .on : .off
        contrastItem?.state = overlay.highContrast ? .on : .off
    }

    @objc private func toggleHud() {
        hud.setVisible(!hud.isVisible)
        refreshMenu()
    }

    @objc private func resetHud() {
        hud.resetPosition()
        if !hud.isVisible { hud.setVisible(true) }
        refreshMenu()
    }

    @objc private func toggleContrast() { hudClicked("contrast") }

    @objc private func quit() { NSApp.terminate(nil) }

    private func startTapWhenTrusted() {
        if tap.start() { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.startTapWhenTrusted() }
    }

    private func checkHubShown() { if hud.isVisible { hud.place() } }

    // MARK: frontmost

    @objc private func appActivated(_ n: Notification) {
        let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        reportFrontmost(app)
    }

    private func reportFrontmost(_ app: NSRunningApplication?) {
        guard let app, let bid = app.bundleIdentifier, bid != selfBundleId else { return }
        terminal.setFrontmost(app)
        var title = ""
        if AXIsProcessTrusted(), let w = AX.focusedWindow(pid: app.processIdentifier) { title = AX.attr(w, kAXTitleAttribute) ?? "" }
        hub.send(.frontmost(app: bid, window: title))
    }

    // MARK: hub → A

    private func handle(_ m: HubToShell) {
        switch m {
        case .ghost(let g):
            log("ghost \(g.id) \(g.kind.rawValue) \"\(g.label)\" rect=\(g.rect.map { "\($0.x),\($0.y) \($0.w)×\($0.h)" } ?? "-") pillAt=\(g.pillAt.map { "\($0.x),\($0.y)" } ?? "-")")
            overlay.show(g)
        case .ghostHide:
            log("ghost_hide")
            overlay.hide()
        case .hud(let h):
            lastHud = h
            hud.update(h)
        case .exec(let ghostId, let action):
            exec(ghostId, action)
        case .unknown(let t):
            log("hub: ignoring \(t)")
        }
    }

    private func exec(_ ghostId: String, _ a: Action) {
        guard a.op == "switch_app" else {
            hub.send(.execResult(ghostId: ghostId, ok: false, error: "shell only executes switch_app, got \(a.op)"))
            return
        }
        let bid = a.value ?? a.app
        AppSwitcher.activate(bid) { [weak self] ok, err in
            log("exec \(ghostId): switch_app \(bid) → \(ok ? "ok" : err ?? "failed")")
            self?.hub.send(.execResult(ghostId: ghostId, ok: ok, error: err))
        }
    }

    private func hudClicked(_ item: String) {
        if item == "contrast" {
            overlay.highContrast.toggle()
            hud.setHighContrast(overlay.highContrast)
            overlay.redraw()
            refreshMenu()
        }
        hub.send(.hudClick(item: item))
    }

    // MARK: InputTapDelegate

    var visibleGhost: Ghost? { overlay.current }
    var ownRects: [CGRect] { [hud.screenRect] }

    func tapAccept(_ g: Ghost) {
        guard overlay.current?.id == g.id else { return }
        log("accept \(g.id)")
        overlay.hide(.accept)
        hub.send(.accept(ghostId: g.id))
    }

    func tapDismiss(_ g: Ghost) {
        log("dismiss \(g.id)")
        if overlay.current?.id == g.id { overlay.hide() }
        hub.send(.dismiss(ghostId: g.id))
    }

    func tapBlockedPress(_ g: Ghost) { overlay.shake() }

    func tapOtherInput(kind: String) {
        if let g = overlay.current, g.kind != .done { overlay.hide() }
        hub.send(.input(kind: kind))
    }

    func tapHoldProgress(_ g: Ghost?, started: Bool) {
        if started { overlay.startHold(ms: 600) } else { overlay.stopHold() }
    }
}

enum AppSwitcher {
    /// Activate by bundle id. A background (LSUIElement) app can't always activate others under cooperative activation,
    /// so try NSRunningApplication, then AX frontmost, then LaunchServices; confirm by pid.
    static func activate(_ bid: String, done: @escaping (Bool, String?) -> Void) {
        let instances = NSRunningApplication.runningApplications(withBundleIdentifier: bid)
        guard let app = pick(instances) else { return open(bid, done: done) }
        let pid = app.processIdentifier
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return done(true, nil) }
        app.activate(options: [.activateAllWindows])
        AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        confirm(pid, tries: 6) { ok in
            if ok { return done(true, nil) }
            // LaunchServices can't choose between instances, so only fall back to it when there's one.
            if instances.count == 1 { open(bid, done: done) } else { done(false, "\(bid) (pid \(pid)) did not come to the front") }
        }
    }

    /// With several instances of one app (the user's Chrome and the debug Chrome share a bundle id),
    /// prefer the one started with --remote-debugging-port: that's the one C drives.
    static func pick(_ instances: [NSRunningApplication]) -> NSRunningApplication? {
        if instances.count > 1, let debug = instances.first(where: { arguments(of: $0.processIdentifier).contains { $0.hasPrefix("--remote-debugging-port") } }) {
            return debug
        }
        return instances.first
    }

    /// argv of another process (same user) via sysctl KERN_PROCARGS2: argc, exec path, padding, then argv.
    static func arguments(of pid: pid_t) -> [String] {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else { return [] }
        var buf = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buf, &size, nil, 0) == 0 else { return [] }
        let argc = Int(buf.withUnsafeBytes { $0.load(as: Int32.self) })
        var i = MemoryLayout<Int32>.size
        while i < size, buf[i] != 0 { i += 1 } // exec path
        while i < size, buf[i] == 0 { i += 1 } // padding
        var args: [String] = []
        while args.count < argc, i < size {
            let s = i
            while i < size, buf[i] != 0 { i += 1 }
            args.append(String(decoding: buf[s..<i], as: UTF8.self))
            i += 1
        }
        return args
    }

    private static func open(_ bid: String, done: @escaping (Bool, String?) -> Void) {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bid) else { return done(false, "no app \(bid)") }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: cfg) { app, err in
            DispatchQueue.main.async {
                if let err { return done(false, err.localizedDescription) }
                guard let pid = app?.processIdentifier else { return done(false, "\(bid) did not launch") }
                confirm(pid, tries: 10) { ok in done(ok, ok ? nil : "\(bid) did not come to the front") }
            }
        }
    }

    private static func confirm(_ pid: pid_t, tries: Int, _ cb: @escaping (Bool) -> Void) {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return cb(true) }
        if tries == 0 { return cb(false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { confirm(pid, tries: tries - 1, cb) }
    }
}

// MARK: - --selftest

func selftestGhosts(screen: CGSize) -> [(Ghost, Bool)] {
    func set(_ x0: Double, _ hc: Bool, _ tag: String) -> [(Ghost, Bool)] {
        let w = 200.0, h = 36.0
        var y = 70.0
        var x0 = x0
        let k = hc ? 1.3 : 1.0
        // Wrap to a new column before running off the bottom of the screen.
        func next(_ dy: Double = 84) -> Double {
            if y + dy * k > Double(screen.height) - 60 { y = 70; x0 += hc ? 470 : 380 }
            defer { y += dy * k }
            return y
        }
        var out: [(Ghost, Bool)] = []
        var r = Rect(x: 0, y: next(), w: 120, h: h); r.x = x0
        out.append((Ghost(id: "\(tag)-action", kind: .action, label: "Click Checkout ⇥", rect: r, cursor: Point(x: r.x + r.w / 2, y: r.y + r.h / 2)), hc))
        r = Rect(x: 0, y: next(), w: w + 60, h: h); r.x = x0
        out.append((Ghost(id: "\(tag)-text", kind: .text, label: "⇥", rect: r, ghostText: "4471-209"), hc))
        r = Rect(x: 0, y: next(140), w: w + 160, h: 90); r.x = x0
        out.append((Ghost(id: "\(tag)-textarea", kind: .text, label: "⇥", rect: r,
                          ghostText: "Fix checkout rounding. Totals were rounded per line item instead of once at the end, so 2 × $0.15 could show $0.31."), hc))
        r = Rect(x: 0, y: next(), w: 140, h: h); r.x = x0
        out.append((Ghost(id: "\(tag)-pay", kind: .pay, label: "Pay $0.30 · tickets.localhost ⇥", rect: r), hc))
        r = Rect(x: 0, y: next(), w: 140, h: h); r.x = x0
        out.append((Ghost(id: "\(tag)-blocked", kind: .blocked, label: "Blocked · page says $0.30, payment asks $0.51", rect: r), hc))
        r = Rect(x: 0, y: next(), w: 140, h: h); r.x = x0
        out.append((Ghost(id: "\(tag)-done", kind: .done, label: "Paid $0.30 ✓", rect: r), hc))
        r = Rect(x: 0, y: next(), w: hc ? 440 : 340, h: hc ? 46 : 32); r.x = x0
        out.append((Ghost(id: "\(tag)-repeat", kind: .action, label: "Repeat for ENG-150 · #13 ⇥", rect: r, place: "inside"), hc))
        r = Rect(x: 0, y: next(), w: 90, h: 30); r.x = x0
        out.append((Ghost(id: "\(tag)-batch", kind: .action, label: "Do the remaining 3 ⇥", rect: r), hc))
        out.append((Ghost(id: "\(tag)-term", kind: .action, label: "Open pull request ⇥", pillAt: { let py = next() + 40; return Point(x: x0, y: py) }()), hc))
        return out
    }
    let half = Double(screen.width) / 2
    return set(60, false, "n") + set(half - 120, true, "hc")
}

// MARK: - --render

final class BackgroundView: FlippedView {
    var image: NSImage?
    var dark = false
    override func draw(_ dirty: NSRect) {
        if let image { image.draw(in: bounds); return }
        (dark ? NSColor(srgbRed: 0.12, green: 0.12, blue: 0.13, alpha: 1) : NSColor.white).setFill()
        bounds.fill()
    }
}

func renderSelftest(to out: String) {
    let size = flagValue("--size").map { s -> CGSize in
        let p = s.split(separator: "x").compactMap { Double($0) }
        return CGSize(width: p[0], height: p[1])
    } ?? NSScreen.screens.first!.frame.size
    let root = BackgroundView(frame: CGRect(origin: .zero, size: size))
    root.dark = args.contains("--dark")
    root.image = flagValue("--bg").flatMap { NSImage(contentsOfFile: $0) }
    for (g, hc) in selftestGhosts(screen: size) {
        let v = GhostView(ghost: g, style: Style(hc: hc), frame: root.bounds, usable: root.bounds)
        if g.id.hasSuffix("-repeat") { v.pill.holdFraction = 0.55 } // show the hold sweep mid-way
        root.addSubview(v)
    }
    guard let rep = root.bitmapImageRepForCachingDisplay(in: root.bounds) else { fatalError("no bitmap") }
    root.cacheDisplay(in: root.bounds, to: rep)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
    print("wrote \(out) \(Int(size.width))×\(Int(size.height)) pt")
}

func renderHUD(to out: String) {
    let states: [(String, Bool, Hud)] = [
        ("offline", false, Hud()),
        ("idle", true, Hud(mode: "idle", modelCalls: 0, shown: 0, accepted: 0, tabDid: TabDid(clicks: 0, keys: 0), youDid: 0)),
        ("predicting", true, Hud(mode: "predicting", lastSource: "model", lastLatencyMs: 212, modelCalls: 3, shown: 3, accepted: 2,
                                 tabDid: TabDid(clicks: 3, keys: 0), youDid: 5)),
        ("shown", true, Hud(mode: "shown", lastSource: "pattern", lastLatencyMs: 2.7, modelCalls: 3, shown: 4, accepted: 3,
                            tabDid: TabDid(clicks: 9, keys: 14), youDid: 9)),
        ("running", true, Hud(mode: "running", lastSource: "pattern", lastLatencyMs: 1.9, modelCalls: 3, shown: 5, accepted: 4,
                              tabDid: TabDid(clicks: 14, keys: 21), youDid: 10)),
        ("paid", true, Hud(mode: "shown", lastSource: "model", lastLatencyMs: 188, modelCalls: 4, shown: 6, accepted: 5,
                           tabDid: TabDid(clicks: 6, keys: 0), youDid: 7,
                           lastTx: LastTx(hash: "0x8f3a91c2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f",
                                          explorerUrl: "https://sepolia.basescan.org/tx/0x8f3a", amountUsd: "0.30"))),
    ]
    let s = HUDView.size
    let gap: CGFloat = 16
    let root = BackgroundView(frame: CGRect(x: 0, y: 0, width: CGFloat(states.count) * (s.width + gap) + gap, height: s.height + 2 * gap))
    root.dark = false
    for (i, (_, connected, h)) in states.enumerated() {
        let v = HUDView(frame: CGRect(x: gap + CGFloat(i) * (s.width + gap), y: gap, width: s.width, height: s.height))
        v.connected = connected
        v.hud = h
        v.highContrast = i == states.count - 1
        root.addSubview(v)
    }
    guard let rep = root.bitmapImageRepForCachingDisplay(in: root.bounds) else { fatalError("no bitmap") }
    root.cacheDisplay(in: root.bounds, to: rep)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
    print("wrote \(out)")
}

// MARK: - main

if let bid = flagValue("--which") {
    for a in NSRunningApplication.runningApplications(withBundleIdentifier: bid) {
        let dbg = AppSwitcher.arguments(of: a.processIdentifier).contains { $0.hasPrefix("--remote-debugging-port") }
        print("pid \(a.processIdentifier)\(dbg ? " (debug)" : "")")
    }
    print("switch_app picks pid \(AppSwitcher.pick(NSRunningApplication.runningApplications(withBundleIdentifier: bid))?.processIdentifier ?? -1)")
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
if let out = flagValue("--render-hud") {
    renderHUD(to: out)
    exit(0)
}
if let out = flagValue("--render") {
    renderSelftest(to: out)
    exit(0)
}
let highContrast = args.contains("--high-contrast")
var shell: Shell?
var selftestOverlay: Overlay?

if args.contains("--selftest") {
    let o = Overlay(highContrast: highContrast)
    o.showAll(selftestGhosts(screen: NSScreen.screens.first!.frame.size))
    selftestOverlay = o
    log("selftest: drawing every ghost kind (left normal, right high contrast)")
} else {
    let url = URL(string: flagValue("--hub") ?? "ws://127.0.0.1:\(ProcessInfo.processInfo.environment["HUB_PORT"] ?? "7800")")!
    shell = Shell(hubURL: url, highContrast: highContrast)
    shell!.start()
    log("TabShell running · hub \(url)")
}

signal(SIGTERM) { _ in exit(0) }
app.run()
