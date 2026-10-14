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

    /// Where the text comes from: "auto" (AX, then the session log), "ax", or "log". Env TAB_TERM_SOURCE or --term-log.
    static var source: String {
        if CommandLine.arguments.contains("--term-log") { return "log" }
        return ProcessInfo.processInfo.environment["TAB_TERM_SOURCE"] ?? "auto"
    }

    static func snapshot(pid: pid_t, bundleId: String) -> Result<TerminalSnapshot, ReadError> {
        var axError = "skipped"
        if source != "log" {
            switch axSnapshot(pid: pid, bundleId: bundleId) {
            case .success(let s): return .success(s)
            case .failure(let e): axError = e.description
            }
            if source == "ax" { return .failure(ReadError(axError)) }
        }
        guard let text = SessionLog.read() else {
            return .failure(ReadError("AX: \(axError); session log: none at \(SessionLog.path) (run `script -q \(SessionLog.path)` in the demo terminal)"))
        }
        guard let frame = windowFrame(pid: pid) else { return .failure(ReadError("no on-screen window for \(bundleId)")) }
        var title = ""
        if AXIsProcessTrusted(), let w = AX.focusedWindow(pid: pid) { title = AX.attr(w, kAXTitleAttribute) ?? "" }
        return .success(TerminalSnapshot(app: bundleId, window: title, frame: frame, lines: lastLines(text),
                                         path: "session log \(SessionLog.path) (AX: \(axError))"))
    }

    static func axSnapshot(pid: pid_t, bundleId: String) -> Result<TerminalSnapshot, ReadError> {
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

    /// Frontmost on-screen window of `pid`, in top-left screen points. CGWindowList bounds need no permission.
    static func windowFrame(pid: pid_t) -> Rect? {
        if AXIsProcessTrusted(), let w = AX.focusedWindow(pid: pid), let f = AX.frame(w) { return f }
        // On-screen windows first (front to back); all windows if none (another Space, or the screen is locked).
        for opts: CGWindowListOption in [[.optionOnScreenOnly, .excludeDesktopElements], [.optionAll]] {
            guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { continue }
            for w in list where (w[kCGWindowOwnerPID as String] as? pid_t) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
                guard let b = w[kCGWindowBounds as String] as? [String: Double], let width = b["Width"], width > 100,
                      let height = b["Height"], height > 100 else { continue }
                return Rect(x: b["X"] ?? 0, y: b["Y"] ?? 0, w: width, h: height)
            }
        }
        return nil
    }

    /// The last 40 lines, with trailing blank lines and trailing spaces removed.
    static func lastLines(_ text: String) -> [String] {
        var lines = text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).map { s -> String in
            var t = Array(s)
            while let last = t.last, last == " " || last == "\r" { t.removeLast() }
            var v = String.UnicodeScalarView()
            v.append(contentsOf: t)
            return String(v)
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

/// Fallback when Terminal's text isn't readable via AX: the demo terminal runs `script -q ~/.tab/term.log`,
/// and we read the file's tail, strip escape sequences, and apply carriage returns and backspaces.
enum SessionLog {
    static var path: String {
        ProcessInfo.processInfo.environment["TAB_TERM_LOG"] ?? (NSHomeDirectory() + "/.tab/term.log")
    }

    static func read(tailBytes: Int = 64 * 1024) -> String? {
        guard let fh = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? fh.close() }
        let size = (try? fh.seekToEnd()) ?? 0
        try? fh.seek(toOffset: size > UInt64(tailBytes) ? size - UInt64(tailBytes) : 0)
        guard let data = try? fh.readToEnd() else { return "" }
        return clean(String(decoding: data, as: UTF8.self))
    }

    /// Strip CSI/OSC/other escapes, then render each line: \r returns to column 0 and overwrites, \b moves back one.
    static func clean(_ raw: String) -> String {
        var out = ""
        var it = Array(raw.unicodeScalars)[...]
        var plain = String.UnicodeScalarView()
        while let c = it.first {
            it = it.dropFirst()
            if c == "\u{1B}" {
                guard let n = it.first else { break }
                it = it.dropFirst()
                if n == "[" { // CSI: params, then one final byte in 0x40...0x7E
                    while let f = it.first { it = it.dropFirst(); if (0x40...0x7E).contains(f.value) { break } }
                } else if n == "]" { // OSC: until BEL or ESC \\
                    while let f = it.first {
                        it = it.dropFirst()
                        if f == "\u{07}" { break }
                        if f == "\u{1B}", it.first == "\\" { it = it.dropFirst(); break }
                    }
                } else if n == "(" || n == ")" { it = it.dropFirst() } // charset designation
                continue
            }
            if c == "\u{07}" || c == "\u{04}" { continue }
            plain.append(c)
        }
        // Work on scalars: Swift treats "\r\n" as one Character, which would hide the line breaks.
        var line: [Unicode.Scalar] = []
        var col = 0
        func flush() {
            var l = String.UnicodeScalarView()
            l.append(contentsOf: line)
            out += String(l) + "\n"
            line = []
            col = 0
        }
        for ch in plain {
            switch ch {
            case "\n": flush()
            case "\r": col = 0
            case "\u{08}": col = max(0, col - 1)
            default:
                if col < line.count { line[col] = ch } else { line.append(ch) }
                col += 1
            }
        }
        if !line.isEmpty { flush() }
        return out
    }
}
