// The end-of-demo reveal (PLAN demo script, flow 4 step 7: "Reveal the HUD totals"): the HUD's Tab did / You did
// block, 2.4× and centred on the main display, counting up from 0. Open it by clicking the HUD's numbers or from the
// menu bar; any click or key closes it. It's a snapshot: the totals at the moment it opened.
import AppKit

final class Reveal {
    static let scale: CGFloat = 2.4
    private let panel: HUDPanel
    private let view: HUDView

    init() {
        let size = CGSize(width: HUDView.size.width * Reveal.scale, height: HUDView.revealHeight * Reveal.scale)
        panel = HUDPanel(contentRect: CGRect(origin: .zero, size: size), styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = true // resets the level, so the level comes after
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 2) // over ghosts and the HUD
        view = HUDView(frame: CGRect(origin: .zero, size: size))
        view.revealOnly = true
        view.drawScale = Reveal.scale
        view.countSeconds = 1.4
        panel.contentView = view
        view.onClick = { [weak self] _ in self?.hide() }
    }

    var isVisible: Bool { panel.isVisible }

    /// Top-left screen rect while shown (clicks there are ours, not the user's input).
    var screenRect: CGRect { panel.isVisible ? Screens.topLeft(panel.frame) : .zero }

    func show(_ hud: Hud, connected: Bool) {
        guard let screen = NSScreen.screens.first else { return }
        let vf = screen.visibleFrame, f = panel.frame
        panel.setFrameOrigin(CGPoint(x: (vf.midX - f.width / 2).rounded(), y: (vf.midY - f.height / 2 + vf.height * 0.06).rounded()))
        view.connected = connected
        view.hud = Hud() // from zero…
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.18
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.view.hud = hud } // …up to the totals
    }

    func hide() {
        guard panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.15
            ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in self?.panel.orderOut(nil) })
    }

    /// Offscreen render of the card at its final numbers, for --render-reveal.
    static func render(_ hud: Hud, to out: String) {
        let size = CGSize(width: HUDView.size.width * scale, height: HUDView.revealHeight * scale)
        let pad: CGFloat = 40
        let root = BackgroundView(frame: CGRect(x: 0, y: 0, width: size.width + 2 * pad, height: size.height + 2 * pad))
        root.dark = false
        let v = HUDView(frame: CGRect(x: pad, y: pad, width: size.width, height: size.height))
        v.revealOnly = true
        v.drawScale = scale
        v.connected = true
        v.hud = hud
        root.addSubview(v)
        guard let rep = root.bitmapImageRepForCachingDisplay(in: root.bounds) else { fatalError("no bitmap") }
        root.cacheDisplay(in: root.bounds, to: rep)
        try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
        print("wrote \(out)")
    }
}
