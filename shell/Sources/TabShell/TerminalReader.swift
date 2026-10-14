// Reads the focused Terminal/iTerm2 window's text via AX: focused window → AXTextArea → AXValue.
// AX calls run on a background queue with a short messaging timeout, never on the tap.
import AppKit
import ApplicationServices

let terminalApps: Set<String> = ["com.apple.Terminal", "com.googlecode.iterm2"]

struct TerminalSnapshot {
    var app: String
    var window: String
    var frame: Rect
    var lines: [String]
    var path: String // how the text was found, for --dump
}

enum AX {
    static func attr<T>(_ el: AXUIElement, _ name: String) -> T? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
        return v as? T
    }

    static func children(_ el: AXUIElement) -> [AXUIElement] {
        attr(el, kAXChildrenAttribute) ?? []
    }

    static func role(_ el: AXUIElement) -> String { attr(el, kAXRoleAttribute) ?? "" }

    static func frame(_ el: AXUIElement) -> Rect? {
        guard let pv: AXValue = attr(el, kAXPositionAttribute), let sv: AXValue = attr(el, kAXSizeAttribute) else { return nil }
        var p = CGPoint.zero, s = CGSize.zero
        AXValueGetValue(pv, .cgPoint, &p)
        AXValueGetValue(sv, .cgSize, &s)
        return Rect(x: p.x, y: p.y, w: s.width, h: s.height)
    }

    static func focusedWindow(pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        if let w: AXUIElement = attr(app, kAXFocusedWindowAttribute) { return w }
        if let w: AXUIElement = attr(app, kAXMainWindowAttribute) { return w }
        let ws: [AXUIElement] = attr(app, kAXWindowsAttribute) ?? []
        return ws.first
    }

    /// Breadth-first search for the first element with `role`, at most `depth` levels down.
    static func find(_ root: AXUIElement, role want: String, depth: Int = 6) -> (AXUIElement, String)? {
        var q: [(AXUIElement, Int, String)] = [(root, 0, role(root))]
        while !q.isEmpty {
            let (el, d, path) = q.removeFirst()
            if role(el) == want { return (el, path) }
            if d >= depth { continue }
            for c in children(el) { q.append((c, d + 1, path + " > " + role(c))) }
        }
        return nil
    }
}

struct ReadError: Error, CustomStringConvertible {
    let description: String
    init(_ s: String) { description = s }
}

enum TerminalReader {
    static let keepLines = 40

    static func snapshot(pid: pid_t, bundleId: String) -> Result<TerminalSnapshot, ReadError> {
        guard AXIsProcessTrusted() else { return .failure(ReadError("Accessibility not granted to this process")) }
        guard let win = AX.focusedWindow(pid: pid) else { return .failure(ReadError("no window for \(bundleId) (pid \(pid))")) }
        let title: String = AX.attr(win, kAXTitleAttribute) ?? ""
        guard let frame = AX.frame(win) else { return .failure(ReadError("window has no frame")) }
        guard let (area, path) = AX.find(win, role: kAXTextAreaRole as String) else {
            return .failure(ReadError("no AXTextArea under the focused window"))
        }
        guard let text: String = AX.attr(area, kAXValueAttribute) else { return .failure(ReadError("AXTextArea has no AXValue (\(path))")) }
        return .success(TerminalSnapshot(app: bundleId, window: title, frame: frame, lines: lastLines(text), path: path + " → AXValue"))
    }

    /// The last 40 lines, with trailing blank lines and trailing spaces removed.
    static func lastLines(_ text: String) -> [String] {
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map { s -> String in
            var t = Substring(s)
            while let last = t.last, last == " " || last == "\r" { t = t.dropLast() }
            return String(t)
        }
        while let last = lines.last, last.isEmpty { lines.removeLast() }
        return Array(lines.suffix(keepLines))
    }

    static func state(_ s: TerminalSnapshot, seq: Int) -> ScreenState {
        let el = El(id: "term", role: "textarea", label: "Terminal", value: s.lines.joined(separator: "\n"), options: nil, checked: nil,
                    rect: s.frame, enabled: true, path: nil, list: nil)
        return ScreenState(source: "native", app: s.app, window: s.window, url: nil, focused: true, elements: [el], seq: seq, ts: nowMs())
    }
}

/// Polls the frontmost terminal every 300 ms and reports changes.
final class TerminalPoller {
    private let queue = DispatchQueue(label: "tab.terminal")
    private var timer: DispatchSourceTimer?
    private var last: (text: String, frame: Rect)?
    private var lastError: String?
    private var seq = 0
    private var target: (pid: pid_t, bundleId: String)?
    var onState: ((ScreenState) -> Void)?

    /// Call on the main thread whenever the frontmost app changes.
    func setFrontmost(_ app: NSRunningApplication?) {
        let t: (pid_t, String)? = app.flatMap { a in a.bundleIdentifier.flatMap { terminalApps.contains($0) ? (a.processIdentifier, $0) : nil } }
        queue.async {
            self.target = t.map { (pid: $0.0, bundleId: $0.1) }
            self.last = nil // resend on refocus
        }
        if t != nil, timer == nil { startTimer() }
    }

    private func startTimer() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: .milliseconds(300), leeway: .milliseconds(30))
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume()
        timer = t
    }

    private func tick() {
        guard let target else { return }
        switch TerminalReader.snapshot(pid: target.pid, bundleId: target.bundleId) {
        case .failure(let err):
            let e = err.description
            if e != lastError { log("terminal: \(e)"); lastError = e }
        case .success(let s):
            lastError = nil
            let text = s.lines.joined(separator: "\n")
            if let last, last.text == text, last.frame == s.frame { return }
            last = (text, s.frame)
            seq += 1
            let st = TerminalReader.state(s, seq: seq)
            DispatchQueue.main.async { self.onState?(st) }
        }
    }
}
