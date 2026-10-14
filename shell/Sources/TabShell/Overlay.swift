// The ghost overlay: one borderless, transparent, click-through window over the main display.
// The content view is flipped and covers the main screen, so AX/top-left screen points are view points.
import AppKit

/// Every visual number lives here. `design/ghost-spec.md` is the source of truth for these values.
struct Style {
    var hc: Bool

    // Highlight box
    var boxOutset: CGFloat { hc ? 4 : 3 }
    var boxRadius: CGFloat { 7 }
    var boxStroke: CGFloat { hc ? 4 : 2 }
    var boxFillAlpha: CGFloat { hc ? 0.0 : 0.06 }

    // Pill
    var pillScale: CGFloat { hc ? 1.5 : 1 }
    var pillFont: NSFont { .systemFont(ofSize: 13 * pillScale, weight: .semibold) }
    var pillPadH: CGFloat { 10 * pillScale }
    var pillPadV: CGFloat { 5 * pillScale }
    var pillGap: CGFloat { 6 }

    // Ghost text
    var ghostTextAlpha: CGFloat { hc ? 1.0 : 0.55 }

    // Motion (ms)
    var appearMs: Double { 120 }
    var dismissMs: Double { 90 }
    var acceptFlashMs: Double { 80 }

    static let gray = NSColor(srgbRed: 0x8E / 255, green: 0x8E / 255, blue: 0x93 / 255, alpha: 1)
    static let yellow = NSColor(srgbRed: 0xFF / 255, green: 0xD6 / 255, blue: 0x0A / 255, alpha: 1)
    static let red = NSColor(srgbRed: 0xFF / 255, green: 0x3B / 255, blue: 0x30 / 255, alpha: 1)
    static let green = NSColor(srgbRed: 0x30 / 255, green: 0xB0 / 255, blue: 0x50 / 255, alpha: 1)
    static let ink = NSColor(srgbRed: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255, alpha: 1)

    func stroke(_ k: GhostKind) -> NSColor {
        switch k {
        case .blocked: return Style.red
        case .done: return Style.green
        default: return hc ? Style.yellow : Style.gray.withAlphaComponent(0.7)
        }
    }

    func pillFill(_ k: GhostKind) -> NSColor {
        switch k {
        case .blocked: return Style.red
        case .done: return Style.green
        case .pay: return Style.ink.withAlphaComponent(0.92)
        default: return hc ? Style.ink : Style.gray.withAlphaComponent(0.92)
        }
    }

    func pillText(_ k: GhostKind) -> NSColor {
        switch k {
        case .pay: return hc ? Style.yellow : .white
        default: return .white
        }
    }

    func pillBorder(_ k: GhostKind) -> NSColor? {
        if hc && (k == .action || k == .text || k == .pay) { return Style.yellow }
        return nil
    }
}

/// Draws one ghost into a full-screen flipped view.
final class GhostView: NSView {
    let ghost: Ghost
    let style: Style
    private(set) var pillRect: CGRect = .zero
    /// 0...1 while Tab is held (long press = dismiss); nil when not held.
    var holdProgress: CGFloat? { didSet { setNeedsDisplay(pillRect.insetBy(dx: -4, dy: -4)) } }
    /// Drawn once on accept, just before the fade.
    var accepted = false { didSet { needsDisplay = true } }
    private let screenBounds: CGRect // top-left coords
    private let usable: CGRect // below the menu bar

    init(ghost: Ghost, style: Style, frame: CGRect, usable: CGRect) {
        self.ghost = ghost
        self.style = style
        self.screenBounds = CGRect(origin: .zero, size: frame.size)
        self.usable = usable
        super.init(frame: frame)
        wantsLayer = true
        pillRect = layoutPill()
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private var pillAttrs: [NSAttributedString.Key: Any] {
        [.font: style.pillFont, .foregroundColor: style.pillText(ghost.kind)]
    }

    private var ghostTextFont: NSFont {
        guard let r = ghost.rect else { return .systemFont(ofSize: 14) }
        return .systemFont(ofSize: r.h < 44 ? max(12, min(15, r.h * 0.42)) : 14)
    }

    private var isMultiline: Bool { (ghost.rect?.h ?? 0) >= 44 }

    private func textInset() -> CGFloat { 8 }

    private func boxRect() -> CGRect? {
        guard let r = ghost.rect else { return nil }
        let o = style.boxOutset
        return CGRect(x: r.x - o, y: r.y - o, width: r.w + 2 * o, height: r.h + 2 * o)
    }

    private func layoutPill() -> CGRect {
        let text = ghost.label as NSString
        let ts = text.size(withAttributes: pillAttrs)
        let size = CGSize(width: ceil(ts.width) + 2 * style.pillPadH, height: ceil(ts.height) + 2 * style.pillPadV)
        var p: CGPoint
        if ghost.kind == .text, let r = ghost.rect, let gt = ghost.ghostText, !isMultiline {
            // Inline, right after the ghost text, if it fits inside the field.
            let tw = (gt as NSString).size(withAttributes: [.font: ghostTextFont]).width
            let x = r.x + textInset() + tw + 6
            if x + size.width <= r.x + r.w - 4 {
                return CGRect(x: x, y: r.y + (r.h - size.height) / 2, width: size.width, height: size.height)
            }
            p = CGPoint(x: r.x + r.w + style.pillGap + style.boxOutset, y: r.y + (r.h - size.height) / 2)
        } else if let b = boxRect() {
            p = CGPoint(x: b.minX, y: b.maxY + style.pillGap)
            if p.y + size.height > usable.maxY { p.y = b.minY - style.pillGap - size.height }
        } else if let a = ghost.pillAt {
            // pillAt is the pill's bottom-left corner.
            p = CGPoint(x: a.x, y: a.y - size.height)
        } else {
            p = CGPoint(x: usable.midX - size.width / 2, y: usable.minY + 40)
        }
        p.x = min(max(p.x, usable.minX + 4), usable.maxX - size.width - 4)
        p.y = min(max(p.y, usable.minY + 4), usable.maxY - size.height - 4)
        return CGRect(origin: p, size: size)
    }

    override func draw(_ dirty: NSRect) {
        let k = ghost.kind

        if let b = boxRect() {
            let path = NSBezierPath(roundedRect: b, xRadius: style.boxRadius, yRadius: style.boxRadius)
            path.lineWidth = style.boxStroke
            if style.boxFillAlpha > 0 {
                style.stroke(k).withAlphaComponent(style.boxFillAlpha).setFill()
                path.fill()
            }
            style.stroke(k).setStroke()
            path.stroke()
        }

        if k == .text, let r = ghost.rect, let gt = ghost.ghostText {
            let font = ghostTextFont
            let color = (style.hc ? NSColor.black : Style.gray).withAlphaComponent(style.ghostTextAlpha)
            let para = NSMutableParagraphStyle()
            para.lineBreakMode = isMultiline ? .byWordWrapping : .byTruncatingTail
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: para]
            let inset = textInset()
            if isMultiline {
                (gt as NSString).draw(in: CGRect(x: r.x + inset, y: r.y + inset, width: r.w - 2 * inset, height: r.h - 2 * inset), withAttributes: attrs)
            } else {
                let lh = ceil(font.ascender - font.descender + font.leading)
                (gt as NSString).draw(in: CGRect(x: r.x + inset, y: r.y + (r.h - lh) / 2, width: r.w - 2 * inset, height: lh), withAttributes: attrs)
            }
        }

        if let c = ghost.cursor, k != .text {
            drawCursor(at: CGPoint(x: c.x, y: c.y), color: style.hc ? Style.yellow : Style.gray)
        }

        drawPill()
    }

    private func drawPill() {
        let r = pillRect
        let path = NSBezierPath(roundedRect: r, xRadius: r.height / 2, yRadius: r.height / 2)
        NSGraphicsContext.saveGraphicsState()
        let sh = NSShadow()
        sh.shadowColor = NSColor.black.withAlphaComponent(0.25)
        sh.shadowBlurRadius = 6
        sh.shadowOffset = NSSize(width: 0, height: -2)
        sh.set()
        style.pillFill(ghost.kind).setFill()
        path.fill()
        NSGraphicsContext.restoreGraphicsState()
        if let b = style.pillBorder(ghost.kind) {
            b.setStroke()
            path.lineWidth = 2
            path.stroke()
        }
        if accepted {
            NSColor.white.withAlphaComponent(0.35).setFill()
            path.fill()
        }
        let ts = (ghost.label as NSString).size(withAttributes: pillAttrs)
        (ghost.label as NSString).draw(at: CGPoint(x: r.minX + style.pillPadH, y: r.minY + (r.height - ts.height) / 2), withAttributes: pillAttrs)
        if let p = holdProgress {
            // Hold-to-dismiss: a bar filling along the bottom of the pill, clipped to the capsule.
            NSGraphicsContext.saveGraphicsState()
            path.addClip()
            let bh = max(3, r.height * 0.12)
            NSColor.white.withAlphaComponent(0.25).setFill()
            CGRect(x: r.minX, y: r.maxY - bh, width: r.width, height: bh).fill()
            NSColor.white.withAlphaComponent(0.9).setFill()
            CGRect(x: r.minX, y: r.maxY - bh, width: r.width * min(1, p), height: bh).fill()
            NSGraphicsContext.restoreGraphicsState()
        }
    }

    private func drawCursor(at p: CGPoint, color: NSColor) {
        // Arrow, tip at p, in a flipped view (y grows down).
        let s: CGFloat = style.hc ? 1.4 : 1.0
        let pts: [CGPoint] = [(0, 0), (0, 17), (4.2, 13.2), (7.0, 19.6), (9.6, 18.5), (6.9, 12.2), (12.2, 12.2)]
            .map { CGPoint(x: p.x + $0.0 * s, y: p.y + $0.1 * s) }
        let path = NSBezierPath()
        path.move(to: pts[0])
        for q in pts.dropFirst() { path.line(to: q) }
        path.close()
        path.lineJoinStyle = .round
        NSGraphicsContext.saveGraphicsState()
        let sh = NSShadow()
        sh.shadowColor = NSColor.black.withAlphaComponent(0.3)
        sh.shadowBlurRadius = 3
        sh.shadowOffset = NSSize(width: 0, height: -1)
        sh.set()
        color.withAlphaComponent(style.hc ? 1 : 0.85).setFill()
        path.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSColor.white.withAlphaComponent(0.9).setStroke()
        path.lineWidth = 1.2
        path.stroke()
    }
}

final class Overlay {
    private let window: NSWindow
    private let root: NSView
    private var views: [String: GhostView] = [:]
    private var hideTimers: [String: DispatchWorkItem] = [:]
    var highContrast: Bool
    private(set) var current: Ghost?

    init(highContrast: Bool) {
        self.highContrast = highContrast
        let screen = NSScreen.screens.first!
        window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        window.isReleasedWhenClosed = false
        root = FlippedView(frame: CGRect(origin: .zero, size: screen.frame.size))
        root.wantsLayer = true
        window.contentView = root
        window.setFrame(screen.frame, display: true)
        window.orderFrontRegardless()
    }

    private var usable: CGRect {
        let s = NSScreen.screens.first!
        let vf = s.visibleFrame
        // visibleFrame is bottom-left; convert to top-left.
        return CGRect(x: vf.minX, y: s.frame.height - vf.maxY, width: vf.width, height: vf.height)
    }

    /// Show the single live ghost (replaces any other).
    func show(_ g: Ghost) {
        if let cur = current, cur == g, views[g.id] != nil { return }
        for id in Array(views.keys) where id != g.id { remove(id, animated: false) }
        if let old = views[g.id] { old.removeFromSuperview(); views[g.id] = nil }
        current = g
        add(g, animated: true)
        if let ttl = g.ttlMs {
            let w = DispatchWorkItem { [weak self] in
                guard let self, self.current?.id == g.id else { return }
                self.hide()
            }
            hideTimers[g.id] = w
            DispatchQueue.main.asyncAfter(deadline: .now() + ttl / 1000, execute: w)
        }
    }

    /// Selftest: draw many at once.
    func showAll(_ gs: [(Ghost, Bool)]) {
        for id in Array(views.keys) { remove(id, animated: false) }
        for (g, hc) in gs { add(g, animated: false, hc: hc) }
    }

    func hide(accepted: Bool = false) {
        guard let cur = current else { return }
        current = nil
        stopHold()
        if accepted, let v = views[cur.id] {
            v.accepted = true
            DispatchQueue.main.asyncAfter(deadline: .now() + Style(hc: highContrast).acceptFlashMs / 1000) { [weak self] in
                self?.remove(cur.id, animated: true)
            }
        } else {
            remove(cur.id, animated: true)
        }
    }

    private var holdTimer: Timer?

    /// Fill the hold bar over `ms`; the tap decides what happens at the end.
    func startHold(ms: Double) {
        stopHold()
        guard let cur = current, let v = views[cur.id] else { return }
        let t0 = CACurrentMediaTime()
        // Only show the bar after a short delay so a normal tap doesn't flash it.
        let delay = 0.12
        holdTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { _ in
            let el = CACurrentMediaTime() - t0
            guard el >= delay else { return }
            v.holdProgress = CGFloat((el * 1000) / ms)
        }
    }

    func stopHold() {
        holdTimer?.invalidate()
        holdTimer = nil
        for v in views.values where v.holdProgress != nil { v.holdProgress = nil }
    }

    func redraw() {
        let gs = views.values.map(\.ghost)
        let cur = current
        for id in Array(views.keys) { remove(id, animated: false) }
        for g in gs { add(g, animated: false) }
        current = cur
    }

    func shake() {
        guard let cur = current, let v = views[cur.id], let layer = v.layer else { return }
        let a = CAKeyframeAnimation(keyPath: "transform.translation.x")
        a.values = [0, -7, 7, -5, 5, -2, 0]
        a.duration = 0.32
        layer.add(a, forKey: "shake")
    }

    private func add(_ g: Ghost, animated: Bool, hc: Bool? = nil) {
        let v = GhostView(ghost: g, style: Style(hc: hc ?? highContrast), frame: root.bounds, usable: usable)
        views[g.id] = v
        root.addSubview(v)
        if animated {
            v.alphaValue = 0
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = Style(hc: highContrast).appearMs / 1000
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                v.animator().alphaValue = 1
            }
        }
    }

    private func remove(_ id: String, animated: Bool) {
        hideTimers[id]?.cancel()
        hideTimers[id] = nil
        guard let v = views.removeValue(forKey: id) else { return }
        if !animated { v.removeFromSuperview(); return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = Style(hc: highContrast).dismissMs / 1000
            v.animator().alphaValue = 0
        }, completionHandler: { v.removeFromSuperview() })
    }
}

class FlippedView: NSView {
    override var isFlipped: Bool { true }
}
