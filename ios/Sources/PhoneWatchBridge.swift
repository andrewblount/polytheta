#if os(iOS)
import WatchConnectivity
import Foundation
@MainActor
final class PhoneWatchBridge: NSObject, WCSessionDelegate {
    static let shared = PhoneWatchBridge()
    func start() { guard WCSession.isSupported() else { return }; WCSession.default.delegate = self; WCSession.default.activate() }
    func publish(_ state: BrokerPortfolioResponse) {
        guard WCSession.default.activationState == .activated, let data = try? JSONEncoder().encode(state) else { return }
        try? WCSession.default.updateApplicationContext(["portfolio": data])
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        Task { @MainActor in
            do {
                let api = APIClient.shared
                if let data = message["exit"] as? Data {
                    let input = try JSONDecoder().decode(BrokerExitInput.self, from: data)
                    // An exit is sent only from the Watch confirmation action;
                    // no credentials or autonomous trade decisions move to Watch.
                    let result = try await api.requestBrokerExit(input)
                    replyHandler(["message": result.message])
                } else if message["refresh"] as? Bool == true {
                    let state = try await api.brokerPortfolio()
                    publish(state)
                    replyHandler(["portfolio": try JSONEncoder().encode(state)])
                } else { replyHandler(["error": "Unsupported request"]) }
            } catch { replyHandler(["error": error.localizedDescription]) }
        }
    }
}
#endif
