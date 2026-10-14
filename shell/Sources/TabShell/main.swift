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
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.checkHubShown() }
    }

    private func startTapWhenTrusted() {
        if tap.start() { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.startTapWhenTrusted() }
    }

    private func checkHubShown() { hud.place() }

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
        }
        hub.send(.hudClick(item: item))
    }

    // MARK: InputTapDelegate

    var visibleGhost: Ghost? { overlay.current }
    var ownRects: [CGRect] { [hud.screenRect] }

    func tapAccept(_ g: Ghost) {
        guard overlay.current?.id == g.id else { return }
        log("accept \(g.id)")
        overlay.hide(accepted: true)
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
    /// so try NSRunningApplication, then AX frontmost, then LaunchServices; confirm with the frontmost app.
    static func activate(_ bid: String, done: @escaping (Bool, String?) -> Void) {
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bid { return done(true, nil) }
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bid).first else {
            return open(bid, done: done)
        }
        app.activate(options: [.activateAllWindows])
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetAttributeValue(axApp, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        confirm(bid, tries: 6) { ok in ok ? done(true, nil) : open(bid, done: done) }
    }

    private static func open(_ bid: String, done: @escaping (Bool, String?) -> Void) {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bid) else { return done(false, "no app \(bid)") }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, err in
            DispatchQueue.main.async {
                if let err { return done(false, err.localizedDescription) }
                confirm(bid, tries: 10) { ok in done(ok, ok ? nil : "\(bid) did not come to the front") }
            }
        }
    }

    private static func confirm(_ bid: String, tries: Int, _ cb: @escaping (Bool) -> Void) {
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bid { return cb(true) }
        if tries == 0 { return cb(false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { confirm(bid, tries: tries - 1, cb) }
    }
}

// MARK: - --selftest

func selftestGhosts(screen: CGSize) -> [(Ghost, Bool)] {
    func set(_ x0: Double, _ hc: Bool, _ tag: String) -> [(Ghost, Bool)] {
        let w = 200.0, h = 36.0
        var y = 70.0
        let k = hc ? 1.3 : 1.0
        func next(_ dy: Double = 84) -> Double { defer { y += dy * k }; return y }
        var out: [(Ghost, Bool)] = []
        var r = Rect(x: x0, y: next(), w: 120, h: h)
        out.append((Ghost(id: "\(tag)-action", kind: .action, label: "Click Checkout ⇥", rect: r, cursor: Point(x: r.x + r.w / 2, y: r.y + r.h / 2)), hc))
        r = Rect(x: x0, y: next(), w: w + 60, h: h)
        out.append((Ghost(id: "\(tag)-text", kind: .text, label: "⇥", rect: r, ghostText: "4471-209"), hc))
        r = Rect(x: x0, y: next(140), w: w + 160, h: 90)
        out.append((Ghost(id: "\(tag)-textarea", kind: .text, label: "⇥", rect: r,
                          ghostText: "Fix checkout rounding. Totals were rounded per line item instead of once at the end, so 2 × $0.15 could show $0.31."), hc))
        r = Rect(x: x0, y: next(), w: 140, h: h)
        out.append((Ghost(id: "\(tag)-pay", kind: .pay, label: "Pay $0.30 · tickets.localhost ⇥", rect: r), hc))
        r = Rect(x: x0, y: next(), w: 140, h: h)
        out.append((Ghost(id: "\(tag)-blocked", kind: .blocked, label: "Blocked · page says $0.30, payment asks $0.51", rect: r), hc))
        r = Rect(x: x0, y: next(), w: 140, h: h)
        out.append((Ghost(id: "\(tag)-done", kind: .done, label: "Paid $0.30 ✓", rect: r), hc))
        r = Rect(x: x0, y: next(), w: 90, h: 30)
        out.append((Ghost(id: "\(tag)-repeat", kind: .action, label: "Repeat for ENG-150 · #13 ⇥", rect: r, cursor: Point(x: r.x + r.w / 2, y: r.y + r.h / 2)), hc))
        r = Rect(x: x0, y: next(), w: 90, h: 30)
        out.append((Ghost(id: "\(tag)-batch", kind: .action, label: "Do the remaining 3 ⇥", rect: r), hc))
        out.append((Ghost(id: "\(tag)-term", kind: .action, label: "Open pull request ⇥", pillAt: Point(x: x0, y: next() + 40)), hc))
        return out
    }
    let half = Double(screen.width) / 2
    return set(60, false, "n") + set(half + 60, true, "hc")
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
        root.addSubview(GhostView(ghost: g, style: Style(hc: hc), frame: root.bounds, usable: root.bounds))
    }
    guard let rep = root.bitmapImageRepForCachingDisplay(in: root.bounds) else { fatalError("no bitmap") }
    root.cacheDisplay(in: root.bounds, to: rep)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
    print("wrote \(out) \(Int(size.width))×\(Int(size.height)) pt")
}

// MARK: - main

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
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
