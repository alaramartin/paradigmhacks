// Websocket client to the hub (ws://127.0.0.1:7800) with auto-reconnect. All callbacks arrive on the main queue.
import Foundation

final class HubClient: NSObject, URLSessionWebSocketDelegate {
    private let url: URL
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var connected = false
    private var retryScheduled = false

    var onMessage: ((HubToShell) -> Void)?
    var onConnect: (() -> Void)?
    /// Once per lost connection (not on every failed retry).
    var onDisconnect: (() -> Void)?

    init(url: URL) {
        self.url = url
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    }

    func start() { connect() }

    func send(_ m: ShellToHub) {
        guard let data = try? JSONEncoder().encode(m) else { return }
        if connected, let task {
            task.send(.string(String(decoding: data, as: UTF8.self))) { [weak self] err in
                if let err { DispatchQueue.main.async { self?.drop("send: \(err.localizedDescription)") } }
            }
        }
        // While disconnected, drop: stale input/accept would mislead the hub. onConnect resends frontmost and state.
    }

    private func connect() {
        retryScheduled = false
        let t = session.webSocketTask(with: url)
        task = t
        t.resume()
        receive(on: t)
    }

    private func receive(on t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, t === self.task else { return }
                switch result {
                case .failure(let err):
                    self.drop("receive: \(err.localizedDescription)")
                case .success(let msg):
                    var data: Data?
                    switch msg {
                    case .string(let s): data = Data(s.utf8)
                    case .data(let d): data = d
                    @unknown default: break
                    }
                    if let data {
                        do {
                            self.onMessage?(try JSONDecoder().decode(HubToShell.self, from: data))
                        } catch {
                            log("hub: undecodable message \(String(decoding: data.prefix(160), as: UTF8.self)): \(error)")
                        }
                    }
                    self.receive(on: t)
                }
            }
        }
    }

    private func drop(_ why: String) {
        if connected {
            log("hub: disconnected (\(why))")
            onDisconnect?()
        }
        connected = false
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        guard !retryScheduled else { return }
        retryScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.connect() }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard webSocketTask === task else { return }
        connected = true
        log("hub: connected \(url)")
        send(.hello)
        onConnect?()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        guard webSocketTask === task else { return }
        drop("closed \(closeCode.rawValue)")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task else { return }
        drop(error?.localizedDescription ?? "completed")
    }
}
