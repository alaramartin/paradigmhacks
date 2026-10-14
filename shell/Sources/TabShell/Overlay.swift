// The ghost overlay: one borderless, transparent, click-through window over the main display.
// The content view is flipped and covers the main screen, so AX/top-left screen points are view points.
// Every number here comes from design/ghost-spec.md; change the spec first, then this file.
import AppKit

func hex(_ v: UInt32, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: a)
}

struct Style {
    var hc: Bool
    var reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    // Palette
    static let graphite: UInt32 = 0x8E8E93
    static let slate: UInt32 = 0x636366
    static let pay: UInt32 = 0x0052FF
    static let payHC: UInt32 = 0x0040D6
    static let blockFill: UInt32 = 0xD70015
    static let blockStroke: UInt32 = 0xFF3B30
    static let doneFill: UInt32 = 0x248A3D
    static let doneStroke: UInt32 = 0x34C759
    static let yellow: UInt32 = 0xFFD60A

    private var k: CGFloat { hc ? 1.5 : 1 }

    // Box
    var boxOutset: CGFloat { hc ? 5 : 3 }
    var boxRadius: CGFloat { hc ? 9 : 7 }
    func boxStroke(_ kind: GhostKind) -> CGFloat { hc ? 4 : (kind == .blocked ? 3 : 2.5) }
    var hcRing: CGFloat { 1.5 }

    func boxColor(_ kind: GhostKind) -> NSColor {
        switch kind {
        case .action: return hc ? hex(Style.yellow) : hex(Style.graphite, 0.90)
        case .text: return hc ? hex(Style.yellow) : hex(Style.graphite, 0.70)
        case .pay: return hc ? hex(Style.yellow) : hex(Style.pay, 0.90)
        case .blocked: return hex(Style.blockStroke)
        case .done: return hc ? hex(Style.doneStroke) : hex(Style.doneStroke, 0.95)
        }
    }

    func haloColor(_ kind: GhostKind) -> NSColor? {
        if hc { return nil }
        switch kind {
        case .action: return hex(Style.graphite, 0.16)
        case .text: return hex(Style.graphite, 0.12)
        case .pay: return hex(Style.pay, 0.16)
        case .blocked: return hex(Style.blockStroke, 0.20)
        case .done: return hex(Style.doneStroke, 0.18)
        }
    }

    func boxFill(_ kind: GhostKind) -> NSColor? {
        switch kind {
        case .action: return hc ? nil : hex(Style.graphite, 0.08)
        case .text: return nil
        case .pay: return hc ? nil : hex(Style.pay, 0.07)
        case .blocked: return hex(Style.blockStroke, hc ? 0.12 : 0.10)
        case .done: return hc ? nil : hex(Style.doneStroke, 0.08)
        }
    }

    // Pill
    var pillFont: NSFont { .systemFont(ofSize: 14 * k, weight: .semibold) }
    var pillTailFont: NSFont { .systemFont(ofSize: 14 * k, weight: .regular) }
    var pillH: CGFloat { 28 * k }
    var padL: CGFloat { 12 * k }
    var padR: CGFloat { 12 * k }
    var keyInset: CGFloat { 3 * k }
    var keyH: CGFloat { pillH - 2 * keyInset }
    var keyMinW: CGFloat { 1.5 * keyH }
    var keyPadH: CGFloat { 6 * k }
    var keyRadius: CGFloat { 5 * k }
    var keyFont: NSFont { .systemFont(ofSize: 12 * k, weight: .semibold) }
    var keyGap: CGFloat { 8 * k }
    var iconSize: CGFloat { 13 * k }
    var iconGap: CGFloat { 6 * k }
    var gap: CGFloat { hc ? 8 : 6 }
    var clamp: CGFloat { 4 }

    func pillFill(_ kind: GhostKind) -> NSColor {
        switch kind {
        case .action, .text: return hc ? .black : hex(Style.slate, 0.96)
        case .pay: return hc ? hex(Style.payHC) : hex(Style.pay)
        case .blocked: return hex(Style.blockFill)
        case .done: return hex(Style.doneFill)
        }
    }

    func pillText(_ kind: GhostKind) -> NSColor {
        (hc && (kind == .action || kind == .text)) ? hex(Style.yellow) : .white
    }

    /// (color, width) of the inner border: a hairline in normal mode, 2 pt in HC.
    func pillBorder(_ kind: GhostKind) -> (NSColor, CGFloat) {
        if !hc { return (NSColor.white.withAlphaComponent(0.22), 1) }
        switch kind {
        case .action, .text, .pay: return (hex(Style.yellow), 2)
        case .blocked, .done: return (.white, 2)
        }
    }

    func keyFill(_ kind: GhostKind) -> NSColor {
        if hc { return kind == .blocked ? .white : hex(Style.yellow) }
        return NSColor.white.withAlphaComponent(kind == .pay || kind == .blocked ? 0.22 : 0.20)
    }

    var keyText: NSColor { hc ? .black : .white }
    /// Hold-progress sweep fill and the label colour over it.
    var holdFill: NSColor { hc ? .black : .white }
    var holdText: NSColor { hc ? hex(Style.yellow) : hex(Style.slate) }

    var shadow: NSShadow? {
        if hc { return nil }
        let s = NSShadow()
        s.shadowColor = NSColor.black.withAlphaComponent(0.22)
        s.shadowBlurRadius = 8
        s.shadowOffset = NSSize(width: 0, height: -2)
        return s
    }

    // Motion (ms)
    var appearMs: Double { 140 }
    var appearRise: CGFloat { reduceMotion ? 0 : 4 }
    var pressMs: Double { 60 }
    var acceptFadeMs: Double { 120 }
    var dismissMs: Double { 100 }
    var doneFadeMs: Double { 220 }
    var shakeMs: Double { 320 }
    var holdHiddenMs: Double { 150 }
}

/// What the pill says, parsed from the protocol label.
struct PillContent {
    enum Icon { case none, block, check }
    var head: String
    var tail: String? // drawn as " · tail"
    var key: String? // "tab" | "esc"
    var icon: Icon

    init(_ g: Ghost) {
        var label = g.label.trimmingCharacters(in: .whitespaces)
        var hadTab = false
        if label.hasSuffix("⇥") { hadTab = true; label = String(label.dropLast()).trimmingCharacters(in: .whitespaces) }
        icon = .none
        if g.kind == .done, label.hasSuffix("✓") { label = String(label.dropLast()).trimmingCharacters(in: .whitespaces) }
        if g.kind == .done { icon = .check }
        if g.kind == .blocked { icon = .block }
        key = g.kind == .blocked ? "esc" : g.kind == .done ? nil : (hadTab ? "tab" : nil)
        if let r = label.range(of: " · ") {
            head = String(label[..<r.lowerBound])
            tail = String(label[r.upperBound...])
        } else {
            head = label
            tail = nil
        }
    }

    var keyOnly: Bool { head.isEmpty && tail == nil && icon == .none && key != nil }
}

/// The pill: capsule, optional icon, two-weight label, keycap. Its frame includes a margin for the shadow.
final class PillView: NSView {
    static let margin: CGFloat = 12
    let kind: GhostKind
    let style: Style
    let content: PillContent
    let size: CGSize
    var pressed = false { didSet { needsDisplay = true } }
    var holdFraction: CGFloat? { didSet { needsDisplay = true } }
    var borderAlpha: CGFloat = 1 { didSet { needsDisplay = true } }

    private var textAttr: NSAttributedString?
    private var keyW: CGFloat = 0

    init(ghost: Ghost, style: Style) {
        kind = ghost.kind
        self.style = style
        content = PillContent(ghost)
        let textColor = style.pillText(ghost.kind)
        var w: CGFloat
        var attr: NSAttributedString?
        if !content.keyOnly {
            let a = NSMutableAttributedString(string: content.head, attributes: [.font: style.pillFont, .foregroundColor: textColor])
            if let t = content.tail {
                a.append(NSAttributedString(string: " · \(t)", attributes: [.font: style.pillTailFont, .foregroundColor: textColor.withAlphaComponent(0.82)]))
            }
            attr = a
        }
        var kw: CGFloat = 0
        if let key = content.key {
            let tw = (key as NSString).size(withAttributes: [.font: style.keyFont]).width
            kw = max(style.keyMinW, ceil(tw) + 2 * style.keyPadH)
        }
        if content.keyOnly {
            w = kw + 2 * style.keyInset
        } else {
            w = style.padL
            if content.icon != .none { w += style.iconSize + style.iconGap }
            w += ceil(attr?.size().width ?? 0)
            w += content.key != nil ? style.keyGap + kw + style.keyInset : style.padR
        }
        size = CGSize(width: w, height: style.pillH)
        textAttr = attr
        keyW = kw
        super.init(frame: CGRect(origin: .zero, size: CGSize(width: w + 2 * PillView.margin, height: style.pillH + 2 * PillView.margin)))
        wantsLayer = true
    }

    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }

    /// Place the pill (not the margin) with its top-left at `p`.
    func place(at p: CGPoint) { setFrameOrigin(CGPoint(x: p.x - PillView.margin, y: p.y - PillView.margin)) }

    override func draw(_ dirty: NSRect) {
        let r = CGRect(x: PillView.margin, y: PillView.margin, width: size.width, height: size.height)
        let capsule = NSBezierPath(roundedRect: r, xRadius: r.height / 2, yRadius: r.height / 2)

        NSGraphicsContext.saveGraphicsState()
        style.shadow?.set()
        style.pillFill(kind).setFill()
        capsule.fill()
        NSGraphicsContext.restoreGraphicsState()

        // Inner border: stroke a path inset by half the width so it stays inside the capsule.
        // A key-only pill (text ghosts) skips it in HC: the yellow key is the edge, a second ring reads as brackets.
        let (bc, bw) = (style.hc && content.keyOnly) ? (NSColor.clear, 0) : style.pillBorder(kind)
        let ib = r.insetBy(dx: bw / 2, dy: bw / 2)
        let border = NSBezierPath(roundedRect: ib, xRadius: ib.height / 2, yRadius: ib.height / 2)
        border.lineWidth = bw
        bc.withAlphaComponent(bc.alphaComponent * borderAlpha).setStroke()
        border.stroke()

        var x = r.minX + (content.keyOnly ? style.keyInset : style.padL)
        let textColor = style.pillText(kind)
        if content.icon != .none {
            drawIcon(content.icon, in: CGRect(x: x, y: r.midY - style.iconSize / 2, width: style.iconSize, height: style.iconSize), color: textColor)
            x += style.iconSize + style.iconGap
        }
        if let t = textAttr {
            let ts = t.size()
            t.draw(at: CGPoint(x: x, y: r.midY - ts.height / 2))
        }
        if let key = content.key {
            let kr = CGRect(x: r.maxX - style.keyInset - keyW, y: r.minY + style.keyInset, width: keyW, height: style.keyH)
            drawKey(key, in: kr)
        }
    }

    private func drawKey(_ key: String, in kr: CGRect) {
        let path = NSBezierPath(roundedRect: kr, xRadius: style.keyRadius, yRadius: style.keyRadius)
        style.keyFill(kind).setFill()
        path.fill()
        // Key edge: a 1 pt darker band along the bottom so it reads as a physical key (none while pressed).
        if !pressed {
            NSGraphicsContext.saveGraphicsState()
            path.addClip()
            NSColor.black.withAlphaComponent(style.hc ? 0.22 : 0.18).setFill()
            CGRect(x: kr.minX, y: kr.maxY - 1.5 * (style.hc ? 1.5 : 1), width: kr.width, height: 1.5 * (style.hc ? 1.5 : 1)).fill()
            NSGraphicsContext.restoreGraphicsState()
        }
        if pressed {
            (style.hc ? NSColor.black.withAlphaComponent(0.25) : NSColor.white.withAlphaComponent(0.45)).setFill()
            path.fill()
        }
        let ts = (key as NSString).size(withAttributes: [.font: style.keyFont])
        let tp = CGPoint(x: kr.midX - ts.width / 2, y: kr.midY - ts.height / 2)
        let f = min(1, max(0, holdFraction ?? 0))
        let split = kr.minX + kr.width * f
        // Unfilled part.
        NSGraphicsContext.saveGraphicsState()
        CGRect(x: split, y: kr.minY, width: kr.maxX - split, height: kr.height).clip()
        (key as NSString).draw(at: tp, withAttributes: [.font: style.keyFont, .foregroundColor: style.keyText])
        NSGraphicsContext.restoreGraphicsState()
        guard f > 0 else { return }
        // Filled part: the sweep, and the label in the contrasting colour over it.
        NSGraphicsContext.saveGraphicsState()
        path.addClip()
        CGRect(x: kr.minX, y: kr.minY, width: split - kr.minX, height: kr.height).clip()
        style.holdFill.setFill()
        kr.fill()
        (key as NSString).draw(at: tp, withAttributes: [.font: style.keyFont, .foregroundColor: style.holdText])
        NSGraphicsContext.restoreGraphicsState()
    }

    private func drawIcon(_ icon: PillContent.Icon, in r: CGRect, color: NSColor) {
        // 12-unit viewBox, y down.
        let s = r.width / 12
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: r.minX + x * s, y: r.minY + y * s) }
        let path = NSBezierPath()
        switch icon {
        case .block:
            path.appendOval(in: CGRect(x: r.minX + (6 - 4.9) * s, y: r.minY + (6 - 4.9) * s, width: 9.8 * s, height: 9.8 * s))
            path.move(to: p(2.6, 9.4))
            path.line(to: p(9.4, 2.6))
            path.lineWidth = 1.6 * s
        case .check:
            path.move(to: p(2.2, 6.4))
            path.line(to: p(4.9, 9))
            path.line(to: p(9.8, 3.2))
            path.lineWidth = 1.8 * s
        case .none: return
        }
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        color.setStroke()
        path.stroke()
    }
}

/// One ghost: box, field cover + ghost text, cursor (drawn here) and the pill (a subview).
final class GhostView: NSView {
    let ghost: Ghost
    let style: Style
    let pill: PillView
    private(set) var pillRect: CGRect = .zero
    private let usable: CGRect // top-left coords, below the menu bar

    init(ghost: Ghost, style: Style, frame: CGRect, usable: CGRect) {
        self.ghost = ghost
        self.style = style
        self.usable = usable
        pill = PillView(ghost: ghost, style: style)
        super.init(frame: frame)
        wantsLayer = true
        pillRect = layoutPill()
        pill.place(at: pillRect.origin)
        addSubview(pill)
    }

    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }

    // MARK: layout

    private var isMultiline: Bool { (ghost.rect?.h ?? 0) >= 44 }

    private var ghostTextFont: NSFont {
        guard let r = ghost.rect, !isMultiline else { return .systemFont(ofSize: 14) }
        return .systemFont(ofSize: min(15, max(12, r.h * 0.42)))
    }

    private func boxRect() -> CGRect? {
        guard let r = ghost.rect else { return nil }
        let o = style.boxOutset
        return CGRect(x: r.x - o, y: r.y - o, width: r.w + 2 * o, height: r.h + 2 * o)
    }

    private func layoutPill() -> CGRect {
        let size = pill.size
        var p: CGPoint
        if ghost.kind == .text, let r = ghost.rect {
            if isMultiline {
                p = CGPoint(x: r.x + r.w - size.width - 8, y: r.y + r.h - size.height - 8)
            } else {
                let tw = ((ghost.ghostText ?? "") as NSString).size(withAttributes: [.font: ghostTextFont]).width
                let x = r.x + 8 + ceil(tw) + 6
                if x + size.width <= r.x + r.w - 4 {
                    p = CGPoint(x: x, y: r.y + (r.h - size.height) / 2)
                } else {
                    p = CGPoint(x: r.x + r.w + style.gap + style.boxOutset, y: r.y + (r.h - size.height) / 2)
                }
            }
        } else if let b = boxRect(), let r = ghost.rect {
            switch ghost.place {
            case "above":
                p = CGPoint(x: b.minX, y: b.minY - style.gap - size.height)
            case "right":
                p = CGPoint(x: b.maxX + style.gap, y: b.midY - size.height / 2)
            case "inside":
                // Docked at the element's right end like a badge, equal space right and top/bottom.
                let inset = max(4, (r.h - size.height) / 2)
                p = CGPoint(x: r.x + r.w - size.width - inset, y: r.y + (r.h - size.height) / 2)
            default:
                p = CGPoint(x: b.minX, y: b.maxY + style.gap)
                if p.y + size.height > usable.maxY - style.clamp { p.y = b.minY - style.gap - size.height }
            }
        } else if let a = ghost.pillAt {
            p = CGPoint(x: a.x, y: a.y - size.height) // pillAt = the pill's bottom-left corner
        } else {
            p = CGPoint(x: usable.midX - size.width / 2, y: usable.minY + 40)
        }
        p.x = min(max(p.x, usable.minX + style.clamp), usable.maxX - size.width - style.clamp)
        p.y = min(max(p.y, usable.minY + style.clamp), usable.maxY - size.height - style.clamp)
        return CGRect(origin: p, size: size)
    }

    /// The cursor tip, from the rect (lower-right quadrant, clear of centred labels). Only action ghosts with a cursor.
    private func cursorTip() -> CGPoint? {
        guard ghost.kind == .action, ghost.cursor != nil, let r = ghost.rect else { return nil }
        if r.w >= 48 { return CGPoint(x: min(r.x + 0.78 * r.w, r.x + r.w - 14), y: r.y + 0.62 * r.h) }
        return CGPoint(x: r.x + 0.6 * r.w, y: r.y + 0.6 * r.h)
    }

    // MARK: drawing

    override func draw(_ dirty: NSRect) {
        let k = ghost.kind
        if let b = boxRect() {
            let sw = style.boxStroke(k)
            let path = NSBezierPath(roundedRect: b, xRadius: style.boxRadius, yRadius: style.boxRadius)
            if let fill = style.boxFill(k) { fill.setFill(); path.fill() }
            if let halo = style.haloColor(k) {
                let o = sw / 2 + 1.5
                let hr = style.boxRadius + o
                let hp = NSBezierPath(roundedRect: b.insetBy(dx: -o, dy: -o), xRadius: hr, yRadius: hr)
                hp.lineWidth = 3
                halo.setStroke()
                hp.stroke()
            }
            if style.hc {
                path.lineWidth = sw + 2 * style.hcRing
                NSColor.black.setStroke()
                path.stroke()
            }
            path.lineWidth = sw
            style.boxColor(k).setStroke()
            path.stroke()
        }

        if k == .text, let r = ghost.rect { drawGhostText(in: CGRect(x: r.x, y: r.y, width: r.w, height: r.h)) }
        if let tip = cursorTip() { drawCursor(at: tip) }
    }

    private func drawGhostText(in r: CGRect) {
        // Field cover: Tab brings its own paper, so the text reads on any field and hides the page placeholder.
        NSColor.white.setFill()
        NSBezierPath(roundedRect: r.insetBy(dx: 1.5, dy: 1.5), xRadius: 4, yRadius: 4).fill()
        guard let gt = ghost.ghostText, !gt.isEmpty else { return }
        let font = ghostTextFont
        let para = NSMutableParagraphStyle()
        var attrs: [NSAttributedString.Key: Any] = [.font: font, .paragraphStyle: para,
                                                    .foregroundColor: style.hc ? NSColor.black : hex(Style.graphite)]
        if style.hc { attrs[.backgroundColor] = hex(Style.yellow) }
        if isMultiline {
            para.lineBreakMode = .byWordWrapping
            para.minimumLineHeight = 20.3
            para.maximumLineHeight = 20.3
            // Leave the bottom-right corner to the pill.
            (gt as NSString).draw(with: CGRect(x: r.minX + 8, y: r.minY + 8, width: r.width - 16, height: r.height - 16 - pill.size.height),
                                  options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attrs)
        } else {
            para.lineBreakMode = .byTruncatingTail
            let lh = ceil(font.pointSize * 1.2)
            para.minimumLineHeight = lh
            para.maximumLineHeight = lh
            let inline = pillRect.minX > r.minX && pillRect.minX < r.maxX
            let maxW = inline ? pillRect.minX - 6 - (r.minX + 8) + 6 : r.width - 16
            (gt as NSString).draw(with: CGRect(x: r.minX + 8, y: r.midY - lh / 2, width: maxW, height: lh),
                                  options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attrs)
        }
    }

    private func drawCursor(at p: CGPoint) {
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
        sh.shadowColor = NSColor.black.withAlphaComponent(0.30)
        sh.shadowBlurRadius = 3
        sh.shadowOffset = NSSize(width: 0, height: -1)
        sh.set()
        (style.hc ? hex(Style.yellow) : hex(Style.graphite, 0.90)).setFill()
        path.fill()
        NSGraphicsContext.restoreGraphicsState()
        (style.hc ? NSColor.black : NSColor.white.withAlphaComponent(0.95)).setStroke()
        path.lineWidth = style.hc ? 1.5 : 1.2
        path.stroke()
    }
}

final class Overlay {
    enum Exit { case accept, dismiss, done }

    private let window: NSWindow
    private let root: NSView
    private var views: [String: GhostView] = [:]
    private var hideTimers: [String: DispatchWorkItem] = [:]
    private var holdTimer: Timer?
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

    private var style: Style { Style(hc: highContrast) }

    private var usable: CGRect {
        let s = NSScreen.screens.first!
        let vf = s.visibleFrame
        return CGRect(x: vf.minX, y: s.frame.height - vf.maxY, width: vf.width, height: vf.height)
    }

    /// Show the single live ghost (replaces any other).
    func show(_ g: Ghost) {
        if let cur = current, cur == g, views[g.id] != nil { return }
        let sameId = current?.id == g.id
        for id in Array(views.keys) { remove(id, exit: nil) }
        current = g
        add(g, animated: !sameId) // a rect update for the same ghost moves without re-animating
        if let ttl = g.ttlMs {
            let w = DispatchWorkItem { [weak self] in
                guard let self, self.current?.id == g.id else { return }
                self.hide(.done)
            }
            hideTimers[g.id] = w
            DispatchQueue.main.asyncAfter(deadline: .now() + ttl / 1000, execute: w)
        }
    }

    /// Selftest: draw many at once, each with its own contrast mode.
    func showAll(_ gs: [(Ghost, Bool)]) {
        for id in Array(views.keys) { remove(id, exit: nil) }
        for (g, hc) in gs { add(g, animated: false, hc: hc) }
    }

    func hide(_ exit: Exit = .dismiss) {
        guard let cur = current else { return }
        current = nil
        stopHold()
        remove(cur.id, exit: exit)
    }

    func redraw() {
        guard let cur = current else { return }
        for id in Array(views.keys) { remove(id, exit: nil) }
        add(cur, animated: false)
    }

    func shake() {
        guard let cur = current, let v = views[cur.id] else { return }
        if style.reduceMotion {
            let p = v.pill
            p.borderAlpha = 0.4
            DispatchQueue.main.asyncAfter(deadline: .now() + style.shakeMs / 2000) { p.borderAlpha = 1 }
            return
        }
        let a = CAKeyframeAnimation(keyPath: "transform.translation.x")
        a.values = [0, -7, 7, -5, 5, -2, 0]
        a.duration = style.shakeMs / 1000
        v.layer?.add(a, forKey: "shake")
    }

    /// Tab is down on the current ghost: after 150 ms, sweep the keycap to full at `ms` after keyDown.
    func startHold(ms: Double) {
        stopHold()
        guard let cur = current, let v = views[cur.id] else { return }
        let t0 = CACurrentMediaTime()
        let hidden = style.holdHiddenMs / 1000
        holdTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { _ in
            let el = CACurrentMediaTime() - t0
            guard el >= hidden else { return }
            v.pill.holdFraction = CGFloat(el * 1000 / ms)
        }
    }

    func stopHold() {
        holdTimer?.invalidate()
        holdTimer = nil
        for v in views.values where v.pill.holdFraction != nil { v.pill.holdFraction = nil }
    }

    private func add(_ g: Ghost, animated: Bool, hc: Bool? = nil) {
        let st = Style(hc: hc ?? highContrast)
        let v = GhostView(ghost: g, style: st, frame: root.bounds, usable: usable)
        views[g.id] = v
        root.addSubview(v)
        guard animated else { return }
        v.alphaValue = 0
        let target = v.pill.frame.origin
        v.pill.setFrameOrigin(CGPoint(x: target.x, y: target.y + st.appearRise))
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = st.appearMs / 1000
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            v.animator().alphaValue = 1
            v.pill.animator().setFrameOrigin(target)
        }
    }

    /// exit nil = remove at once.
    private func remove(_ id: String, exit: Exit?) {
        hideTimers[id]?.cancel()
        hideTimers[id] = nil
        guard let v = views.removeValue(forKey: id) else { return }
        let st = v.style
        guard let exit else { v.removeFromSuperview(); return }
        switch exit {
        case .dismiss, .done:
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = (exit == .done ? st.doneFadeMs : st.dismissMs) / 1000
                ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
                v.animator().alphaValue = 0
            }, completionHandler: { v.removeFromSuperview() })
        case .accept:
            v.pill.pressed = true
            DispatchQueue.main.asyncAfter(deadline: .now() + st.pressMs / 1000) {
                if !st.reduceMotion, let layer = v.pill.layer {
                    let s = CABasicAnimation(keyPath: "transform.scale")
                    s.fromValue = 1
                    s.toValue = 0.97
                    s.duration = st.acceptFadeMs / 1000
                    s.fillMode = .forwards
                    s.isRemovedOnCompletion = false
                    layer.add(s, forKey: "accept")
                }
                NSAnimationContext.runAnimationGroup({ ctx in
                    ctx.duration = st.acceptFadeMs / 1000
                    ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
                    v.animator().alphaValue = 0
                }, completionHandler: { v.removeFromSuperview() })
            }
        }
    }
}

class FlippedView: NSView {
    override var isFlipped: Bool { true }
}
