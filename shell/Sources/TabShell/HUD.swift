// The HUD: a small non-activating panel in the top right. Clicking it never steals focus.
import AppKit

final class HUDPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class HUD {
    let panel: HUDPanel
    private let view: HUDView
    var onClick: ((String) -> Void)? {
        get { view.onClick }
        set { view.onClick = newValue }
    }

    init() {
        let size = HUDView.size
        panel = HUDPanel(contentRect: CGRect(origin: .zero, size: size), styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isFloatingPanel = true
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        view = HUDView(frame: CGRect(origin: .zero, size: size))
        panel.contentView = view
        place()
        panel.orderFrontRegardless()
    }

    func place() {
        let vf = NSScreen.screens.first!.visibleFrame
        let s = HUDView.size
        panel.setFrameOrigin(CGPoint(x: vf.maxX - s.width - 12, y: vf.maxY - s.height - 12))
    }

    /// Panel frame in top-left screen points (for the input tap).
    var screenRect: CGRect {
        let f = panel.frame
        let h = NSScreen.screens.first!.frame.height
        return CGRect(x: f.minX, y: h - f.maxY, width: f.width, height: f.height)
    }

    func update(_ hud: Hud) { view.hud = hud }
    func setConnected(_ c: Bool) { view.connected = c }
    func setHighContrast(_ hc: Bool) { view.highContrast = hc }
}

final class HUDView: NSView {
    static let size = CGSize(width: 264, height: 168)

    var hud = Hud() { didSet { needsDisplay = true } }
    var connected = false { didSet { needsDisplay = true } }
    var highContrast = false { didSet { needsDisplay = true } }
    var onClick: ((String) -> Void)?

    private var ledgerRect: CGRect = .zero
    private var contrastRect: CGRect = .zero

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { fatalError() }

    private func font(_ size: CGFloat, _ w: NSFont.Weight = .regular, mono: Bool = false) -> NSFont {
        mono ? .monospacedDigitSystemFont(ofSize: size, weight: w) : .systemFont(ofSize: size, weight: w)
    }

    private func text(_ s: String, _ p: CGPoint, _ f: NSFont, _ c: NSColor) -> CGSize {
        let a: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: c]
        (s as NSString).draw(at: p, withAttributes: a)
        return (s as NSString).size(withAttributes: a)
    }

    override func draw(_ dirty: NSRect) {
        let b = bounds.insetBy(dx: 0.5, dy: 0.5)
        let bg = NSBezierPath(roundedRect: b, xRadius: 12, yRadius: 12)
        NSColor(srgbRed: 0.09, green: 0.09, blue: 0.10, alpha: 0.92).setFill()
        bg.fill()
        NSColor.white.withAlphaComponent(0.10).setStroke()
        bg.lineWidth = 1
        bg.stroke()

        let dim = NSColor.white.withAlphaComponent(0.55)
        let fg = NSColor.white.withAlphaComponent(0.92)
        let x: CGFloat = 14
        var y: CGFloat = 12

        // Header: name, mode.
        _ = text("Tab", CGPoint(x: x, y: y), font(13, .bold), fg)
        let mode = connected ? (hud.mode ?? "idle") : "offline"
        let dot: NSColor = !connected ? Style.red : mode == "running" ? Style.yellow : mode == "shown" ? .white : mode == "predicting" ? Style.gray : dim
        let ms = text(mode, CGPoint(x: 0, y: -100), font(11, .medium), dim) // measure
        let mx = bounds.width - 14 - ms.width
        _ = text(mode, CGPoint(x: mx, y: y + 1), font(11, .medium), dim)
        dot.setFill()
        NSBezierPath(ovalIn: CGRect(x: mx - 12, y: y + 5, width: 7, height: 7)).fill()
        y += 22

        // Source · latency · model calls.
        var line = [String]()
        if let s = hud.lastSource { line.append(s) }
        if let l = hud.lastLatencyMs { line.append(l < 10 ? String(format: "%.1f ms", l) : "\(Int(l)) ms") }
        line.append("\(hud.modelCalls ?? 0) model calls")
        _ = text(line.joined(separator: " · "), CGPoint(x: x, y: y), font(11, mono: true), dim)
        y += 16
        _ = text("shown \(hud.shown ?? 0) · accepted \(hud.accepted ?? 0)", CGPoint(x: x, y: y), font(11, mono: true), dim)
        y += 22

        // Counters.
        let td = hud.tabDid ?? TabDid(clicks: 0, keys: 0)
        _ = text("Tab did", CGPoint(x: x, y: y), font(12, .medium), dim)
        _ = text("\(td.clicks) clicks · \(td.keys) keys", CGPoint(x: x + 70, y: y), font(12, .semibold, mono: true), fg)
        y += 18
        _ = text("You did", CGPoint(x: x, y: y), font(12, .medium), dim)
        _ = text("\(hud.youDid ?? 0)", CGPoint(x: x + 70, y: y), font(12, .semibold, mono: true), fg)
        y += 24

        // Last tx + ledger.
        if let tx = hud.lastTx {
            let short = tx.hash.count > 12 ? "\(tx.hash.prefix(6))…\(tx.hash.suffix(4))" : tx.hash
            _ = text("Paid $\(tx.amountUsd) · \(short)", CGPoint(x: x, y: y), font(11, mono: true), fg)
        } else {
            _ = text("no payments yet", CGPoint(x: x, y: y), font(11), dim)
        }
        let ls = text("ledger ↗", CGPoint(x: 0, y: -100), font(11, .semibold), fg)
        ledgerRect = CGRect(x: bounds.width - 14 - ls.width - 8, y: y - 3, width: ls.width + 16, height: ls.height + 6)
        let lp = NSBezierPath(roundedRect: ledgerRect, xRadius: 6, yRadius: 6)
        NSColor.white.withAlphaComponent(hud.lastTx == nil ? 0.05 : 0.12).setFill()
        lp.fill()
        _ = text("ledger ↗", CGPoint(x: ledgerRect.minX + 8, y: y), font(11, .semibold), hud.lastTx == nil ? dim : fg)
        y += 22

        // High-contrast toggle.
        let hs = text("High contrast", CGPoint(x: 0, y: -100), font(11, .medium), dim)
        contrastRect = CGRect(x: x - 4, y: y - 3, width: hs.width + 44, height: hs.height + 6)
        let sw = CGRect(x: x, y: y + 1, width: 24, height: 13)
        let sp = NSBezierPath(roundedRect: sw, xRadius: 6.5, yRadius: 6.5)
        (highContrast ? Style.yellow : NSColor.white.withAlphaComponent(0.2)).setFill()
        sp.fill()
        NSColor.white.setFill()
        NSBezierPath(ovalIn: CGRect(x: highContrast ? sw.maxX - 12 : sw.minX + 1, y: sw.minY + 1, width: 11, height: 11)).fill()
        _ = text("High contrast", CGPoint(x: x + 32, y: y), font(11, .medium), highContrast ? fg : dim)
    }

    override func mouseDown(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        if ledgerRect.contains(p) { onClick?("ledger") }
        else if contrastRect.contains(p) { onClick?("contrast") }
    }
}
