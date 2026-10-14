// The HUD: a small non-activating panel in the top right. Clicking it never steals focus.
// Layout and colours from design/ghost-spec.md ("HUD").
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
    static let size = CGSize(width: 264, height: 196)
    private static let padH: CGFloat = 14
    private static let padV: CGFloat = 12

    var hud = Hud() {
        didSet {
            if hud.lastTx != oldValue.lastTx, hud.lastTx != nil { markPaid() }
            updateDot()
            needsDisplay = true
        }
    }
    var connected = false { didSet { updateDot(); needsDisplay = true } }
    var highContrast = false { didSet { needsDisplay = true } }
    var onClick: ((String) -> Void)?

    private var paidUntil: Date?
    private var ledgerRect: CGRect = .zero
    private var contrastRect: CGRect = .zero
    private var dotAlpha: CGFloat = 1
    private var pulse: Timer?

    private let primary = NSColor.white.withAlphaComponent(0.92)
    private let secondary = NSColor.white.withAlphaComponent(0.60)
    private let disabled = NSColor.white.withAlphaComponent(0.45)

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { fatalError() }

    var mode: String { connected ? (hud.mode ?? "idle") : "offline" }

    private func modeColor() -> NSColor {
        switch mode {
        case "offline": return hex(0xFF3B30)
        case "predicting": return hex(0x0A84FF)
        case "shown": return .white
        case "running": return hex(Style.yellow)
        default: return hex(Style.graphite)
        }
    }

    private func modeFont() -> NSFont { .systemFont(ofSize: 11, weight: .medium) }

    /// Pulse the dot (alpha 1 → .35 → 1, 900 ms) only while predicting.
    private func updateDot() {
        if mode == "predicting" {
            guard pulse == nil else { return }
            let t0 = CACurrentMediaTime()
            pulse = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
                guard let self else { return }
                let ph = (CACurrentMediaTime() - t0).truncatingRemainder(dividingBy: 0.9) / 0.9
                self.dotAlpha = 0.35 + 0.65 * CGFloat((cos(ph * 2 * .pi) + 1) / 2)
                self.setNeedsDisplay(CGRect(x: self.bounds.width - 120, y: 0, width: 120, height: 34))
            }
        } else {
            pulse?.invalidate()
            pulse = nil
            dotAlpha = 1
        }
    }

    private func markPaid() {
        paidUntil = Date().addingTimeInterval(3)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.05) { [weak self] in self?.needsDisplay = true }
    }

    private func mono(_ size: CGFloat, _ w: NSFont.Weight) -> NSFont { .monospacedDigitSystemFont(ofSize: size, weight: w) }

    @discardableResult
    private func text(_ s: String, _ p: CGPoint, _ f: NSFont, _ c: NSColor) -> CGSize {
        let a: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: c]
        (s as NSString).draw(at: p, withAttributes: a)
        return (s as NSString).size(withAttributes: a)
    }

    private func rich(_ parts: [(String, Bool)]) -> NSAttributedString {
        let a = NSMutableAttributedString()
        for (s, strong) in parts {
            a.append(NSAttributedString(string: s, attributes: [.font: mono(11, strong ? .semibold : .regular),
                                                               .foregroundColor: strong ? primary : secondary]))
        }
        return a
    }

    override func draw(_ dirty: NSRect) {
        let b = bounds.insetBy(dx: 0.5, dy: 0.5)
        let bg = NSBezierPath(roundedRect: b, xRadius: 12, yRadius: 12)
        hex(0x1C1C1E, 0.94).setFill()
        bg.fill()
        NSColor.white.withAlphaComponent(0.10).setStroke()
        bg.lineWidth = 1
        bg.stroke()

        let x0 = HUDView.padH
        let x1 = bounds.width - HUDView.padH
        var y = HUDView.padV

        // Row 1: name, mode dot + word.
        text("Tab", CGPoint(x: x0, y: y), .systemFont(ofSize: 13, weight: .bold), primary)
        let mw = (mode as NSString).size(withAttributes: [.font: modeFont()]).width
        text(mode, CGPoint(x: x1 - ceil(mw), y: y + 1.5), modeFont(), secondary)
        modeColor().withAlphaComponent(dotAlpha).setFill()
        NSBezierPath(ovalIn: CGRect(x: x1 - ceil(mw) - 6 - 7, y: y + 5.5, width: 7, height: 7)).fill()
        y += 18 + 10

        // Row 2: the reveal. Tab did / You did.
        let td = hud.tabDid ?? TabDid(clicks: 0, keys: 0)
        let colW = (x1 - x0) / 2
        for (i, (label, n, sub)) in [("Tab did", td.clicks + td.keys, "\(td.clicks) clicks, \(td.keys) keys"),
                                      ("You did", hud.youDid ?? 0, "keys and clicks")].enumerated() {
            let cx = x0 + CGFloat(i) * colW
            text(label, CGPoint(x: cx, y: y), .systemFont(ofSize: 11, weight: .medium), secondary)
            let ns = "\(n)" as NSString
            let nf = mono(26, .semibold)
            let nsz = ns.size(withAttributes: [.font: nf])
            ns.draw(at: CGPoint(x: cx, y: y + 13 + (30 - nsz.height) / 2), withAttributes: [.font: nf, .foregroundColor: primary])
            text(sub, CGPoint(x: cx, y: y + 13 + 30), mono(11, .regular), secondary)
        }
        y += 13 + 30 + 14 + 10

        // Divider.
        NSColor.white.withAlphaComponent(0.10).setFill()
        CGRect(x: x0, y: y, width: x1 - x0, height: 1).fill()
        y += 1 + 8

        // Row 3: source · latency, model calls, accepted/shown — spread across the width.
        let src: NSAttributedString
        if let s = hud.lastSource {
            let lat = hud.lastLatencyMs.map { $0 < 10 ? String(format: " %.1f ms", $0) : " \(Int($0.rounded())) ms" } ?? ""
            src = rich([(s, true), (lat, false)])
        } else {
            src = rich([("no prediction yet", false)])
        }
        let calls = rich([("\(hud.modelCalls ?? 0)", true), (" model calls", false)])
        let acc = rich([("\(hud.accepted ?? 0)", true), ("/\(hud.shown ?? 0) accepted", false)])
        // Space-between: equal gaps, so a long first item never runs into the second.
        let g = max(8, (x1 - x0 - src.size().width - calls.size().width - acc.size().width) / 2)
        src.draw(at: CGPoint(x: x0, y: y))
        calls.draw(at: CGPoint(x: x0 + src.size().width + g, y: y))
        acc.draw(at: CGPoint(x: x1 - acc.size().width, y: y))
        y += 14 + 8

        // Row 4: last payment + ledger.
        let rowH: CGFloat = 22
        let lf = NSFont.systemFont(ofSize: 11, weight: .semibold)
        let lsz = ("ledger ↗" as NSString).size(withAttributes: [.font: lf])
        ledgerRect = CGRect(x: x1 - ceil(lsz.width) - 16, y: y + (rowH - lsz.height - 6) / 2, width: ceil(lsz.width) + 16, height: lsz.height + 6)
        let hasTx = hud.lastTx != nil
        if let tx = hud.lastTx {
            let short = tx.hash.count > 12 ? "\(tx.hash.prefix(6))…\(tx.hash.suffix(4))" : tx.hash
            let fresh = (paidUntil ?? .distantPast) > Date()
            text("\(fresh ? "✓ " : "")Paid $\(tx.amountUsd) · \(short)", CGPoint(x: x0, y: y + 4), mono(11, .regular), fresh ? hex(0x30D158) : primary)
        } else {
            text("No payments yet", CGPoint(x: x0, y: y + 4), .systemFont(ofSize: 11), disabled)
        }
        NSColor.white.withAlphaComponent(hasTx ? 0.12 : 0.05).setFill()
        NSBezierPath(roundedRect: ledgerRect, xRadius: 6, yRadius: 6).fill()
        text("ledger ↗", CGPoint(x: ledgerRect.minX + 8, y: ledgerRect.minY + 3), lf, hasTx ? primary : disabled)
        y += rowH + 8

        // Row 5: high-contrast switch (the whole row is the hit target).
        contrastRect = CGRect(x: 0, y: y - 4, width: bounds.width, height: 22)
        let track = CGRect(x: x0, y: y, width: 24, height: 14)
        (highContrast ? hex(Style.yellow) : NSColor.white.withAlphaComponent(0.20)).setFill()
        NSBezierPath(roundedRect: track, xRadius: 7, yRadius: 7).fill()
        NSColor.white.setFill()
        NSBezierPath(ovalIn: CGRect(x: track.minX + (highContrast ? 11 : 1), y: track.minY + 1, width: 12, height: 12)).fill()
        text("High contrast", CGPoint(x: x0 + 32, y: y), .systemFont(ofSize: 11, weight: .medium), highContrast ? primary : secondary)
    }

    override func mouseDown(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        if ledgerRect.contains(p) {
            if hud.lastTx != nil { onClick?("ledger") }
        } else if contrastRect.contains(p) {
            onClick?("contrast")
        }
    }
}
