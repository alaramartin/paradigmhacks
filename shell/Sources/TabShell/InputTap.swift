// One session-level CGEventTap on keyDown, keyUp and leftMouseDown.
// The callback only reads event fields and touches main-thread state; anything slow (network, AX) is enqueued.
import AppKit
import Carbon.HIToolbox

let tabEventMarker: Int64 = 0x7AB
private let kTab: Int64 = 48
private let kEsc: Int64 = 53
private let holdDismissMs: Double = 600

protocol InputTapDelegate: AnyObject {
    /// The ghost the overlay currently shows, if any.
    var visibleGhost: Ghost? { get }
    /// Screen rects (top-left points) whose clicks are ours, e.g. the HUD.
    var ownRects: [CGRect] { get }
    func tapAccept(_ g: Ghost)
    func tapDismiss(_ g: Ghost)
    func tapBlockedPress(_ g: Ghost)
    func tapOtherInput(kind: String)
    func tapHoldProgress(_ g: Ghost?, started: Bool)
}

final class InputTap {
    weak var delegate: InputTapDelegate?
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?

    // A swallowed Tab press in progress.
    private var tabPress: (ghost: Ghost, downAt: Double, dismissed: Bool)?
    private var holdTimer: DispatchWorkItem?
    private var escSwallowed = false

    var isRunning: Bool { tap != nil }

    /// Returns false if the tap can't be created (no Accessibility grant yet).
    @discardableResult
    func start() -> Bool {
        guard tap == nil else { return true }
        let mask: CGEventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue) | (1 << CGEventType.leftMouseDown.rawValue)
        let me = Unmanaged.passUnretained(self).toOpaque()
        guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                        eventsOfInterest: mask, callback: inputTapCallback, userInfo: me) else { return false }
        tap = t
        source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: t, enable: true)
        log("tap: running")
        return true
    }

    fileprivate func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            log("tap: re-enabling after \(type == .tapDisabledByTimeout ? "timeout" : "user input")")
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        if event.getIntegerValueField(.eventSourceUserData) == tabEventMarker { return Unmanaged.passUnretained(event) }
        guard let d = delegate else { return Unmanaged.passUnretained(event) }

        switch type {
        case .keyDown:
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            let mods = event.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift])
            if code == kTab, tabPress != nil { return nil } // autorepeat of a swallowed press
            if code == kEsc, escSwallowed { return nil }
            if let g = d.visibleGhost, g.kind != .done, mods.isEmpty {
                if code == kTab {
                    tabPress = (g, nowMs(), false)
                    let w = DispatchWorkItem { [weak self] in self?.holdElapsed() }
                    holdTimer = w
                    DispatchQueue.main.asyncAfter(deadline: .now() + holdDismissMs / 1000, execute: w)
                    DispatchQueue.main.async { d.tapHoldProgress(g, started: true) }
                    return nil
                }
                if code == kEsc {
                    escSwallowed = true
                    DispatchQueue.main.async { d.tapDismiss(g) }
                    return nil
                }
            }
            if !IsSecureEventInputEnabled() {
                DispatchQueue.main.async { d.tapOtherInput(kind: "key") }
            }
            return Unmanaged.passUnretained(event)

        case .keyUp:
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            if code == kTab, let p = tabPress {
                tabPress = nil
                holdTimer?.cancel()
                holdTimer = nil
                let held = nowMs() - p.downAt
                DispatchQueue.main.async {
                    d.tapHoldProgress(nil, started: false)
                    if p.dismissed { return }
                    if held >= holdDismissMs { d.tapDismiss(p.ghost) }
                    else if p.ghost.kind == .blocked { d.tapBlockedPress(p.ghost) }
                    else { d.tapAccept(p.ghost) }
                }
                return nil
            }
            if code == kEsc, escSwallowed {
                escSwallowed = false
                return nil
            }
            return Unmanaged.passUnretained(event)

        case .leftMouseDown:
            let loc = event.location
            if d.ownRects.contains(where: { $0.contains(loc) }) { return Unmanaged.passUnretained(event) }
            DispatchQueue.main.async { d.tapOtherInput(kind: "click") }
            return Unmanaged.passUnretained(event)

        default:
            return Unmanaged.passUnretained(event)
        }
    }

    /// Long press (single-switch users have no Esc): dismiss as soon as the hold crosses the threshold.
    private func holdElapsed() {
        guard var p = tabPress, !p.dismissed else { return }
        p.dismissed = true
        tabPress = p
        delegate?.tapHoldProgress(nil, started: false)
        delegate?.tapDismiss(p.ghost)
    }
}

private func inputTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    guard let refcon else { return Unmanaged.passUnretained(event) }
    return Unmanaged<InputTap>.fromOpaque(refcon).takeUnretainedValue().handle(type, event)
}
