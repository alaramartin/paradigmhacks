// Codable mirrors of protocol/types.ts. Coordinates are global screen points, origin top-left of the main display.
import Foundation

struct Rect: Codable, Equatable {
    var x: Double, y: Double, w: Double, h: Double
}

struct Point: Codable, Equatable {
    var x: Double, y: Double
}

struct ListRef: Codable, Equatable {
    var key: String
    var index: Int
    var field: String?
}

struct El: Codable, Equatable {
    var id: String
    var role: String
    var label: String
    var value: String?
    var options: [String]?
    var checked: Bool?
    var rect: Rect
    var enabled: Bool
    var path: String?
    var list: ListRef?
}

struct ScreenState: Codable {
    var type = "state"
    var source: String // "native" | "web"
    var app: String
    var window: String
    var url: String?
    var focused: Bool
    var elements: [El]
    var seq: Int
    var ts: Double
}

final class Action: Codable {
    var op: String
    var app: String
    var url: String?
    var targetId: String?
    var targetPath: String?
    var value: String?
    var steps: [Action]?
    var label: String
    var confidence: Double
    var source: String
}

enum GhostKind: String, Codable {
    case action, text, pay, blocked, done
}

struct Ghost: Codable, Equatable {
    var id: String
    var kind: GhostKind
    var label: String
    var rect: Rect?
    var cursor: Point?
    var pillAt: Point?
    var ghostText: String?
    var ttlMs: Double?
    var place: String? // "below" (default) | "above" | "right" | "inside"
    var avoid: [Rect]? // nearby interactive elements the pill should not cover (used when `place` is absent)
    var radius: Double? = nil // the target's CSS corner radius: the box is drawn concentric with it
}

struct TabDid: Codable, Equatable {
    var clicks: Int
    var keys: Int
}

struct LastTx: Codable, Equatable {
    var hash: String
    var explorerUrl: String
    var amountUsd: String
}

/// Every field optional so a partial hud from the hub still renders.
struct Hud: Codable, Equatable {
    var mode: String?
    var lastSource: String?
    var lastLatencyMs: Double?
    var modelCalls: Int?
    var shown: Int?
    var accepted: Int?
    var tabDid: TabDid?
    var youDid: Int?
    var lastTx: LastTx?
}

// MARK: - hub → A

enum HubToShell: Decodable {
    case ghost(Ghost)
    case ghostHide
    case exec(ghostId: String, action: Action)
    case hud(Hud)
    case unknown(String)

    private enum K: String, CodingKey { case type, ghost, ghostId, action, hud }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "ghost": self = .ghost(try c.decode(Ghost.self, forKey: .ghost))
        case "ghost_hide": self = .ghostHide
        case "exec": self = .exec(ghostId: try c.decode(String.self, forKey: .ghostId), action: try c.decode(Action.self, forKey: .action))
        case "hud": self = .hud(try c.decode(Hud.self, forKey: .hud))
        default: self = .unknown(type)
        }
    }
}

// MARK: - A → hub

enum ShellToHub: Encodable {
    case hello
    case frontmost(app: String, window: String)
    case state(ScreenState)
    case input(kind: String) // "key" | "click"
    case accept(ghostId: String)
    case dismiss(ghostId: String)
    case execResult(ghostId: String, ok: Bool, error: String?)
    case hudClick(item: String) // "ledger" | "contrast"

    private enum K: String, CodingKey { case type, role, app, window, kind, ghostId, ok, error, item }

    func encode(to encoder: Encoder) throws {
        if case .state(let s) = self { return try s.encode(to: encoder) }
        var c = encoder.container(keyedBy: K.self)
        switch self {
        case .hello:
            try c.encode("hello", forKey: .type)
            try c.encode("shell", forKey: .role)
        case .frontmost(let app, let window):
            try c.encode("frontmost", forKey: .type)
            try c.encode(app, forKey: .app)
            try c.encode(window, forKey: .window)
        case .state: break
        case .input(let kind):
            try c.encode("input", forKey: .type)
            try c.encode(kind, forKey: .kind)
        case .accept(let id):
            try c.encode("accept", forKey: .type)
            try c.encode(id, forKey: .ghostId)
        case .dismiss(let id):
            try c.encode("dismiss", forKey: .type)
            try c.encode(id, forKey: .ghostId)
        case .execResult(let id, let ok, let error):
            try c.encode("exec_result", forKey: .type)
            try c.encode(id, forKey: .ghostId)
            try c.encode(ok, forKey: .ok)
            try c.encodeIfPresent(error, forKey: .error)
        case .hudClick(let item):
            try c.encode("hud_click", forKey: .type)
            try c.encode(item, forKey: .item)
        }
    }
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

func log(_ s: String) {
    let f = DateFormatter.logStamp.string(from: Date())
    print("\(f) \(s)")
}

extension DateFormatter {
    static let logStamp: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()
}
