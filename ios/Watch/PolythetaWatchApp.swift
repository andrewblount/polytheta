import SwiftUI
import WatchConnectivity

@main
struct PolythetaWatchApp: App {
    @StateObject private var connection = WatchBrokerConnection()
    var body: some Scene { WindowGroup { WatchTradesView().environmentObject(connection) } }
}
@MainActor
final class WatchBrokerConnection: NSObject, ObservableObject, WCSessionDelegate {
    @Published var state: BrokerPortfolioResponse?
    @Published var message: String?
    @Published var reachable = false
    @Published var busy = false
    override init() {
        super.init()
        WCSession.default.delegate = self; WCSession.default.activate()
        receive(WCSession.default.receivedApplicationContext)
    }
    func receive(_ data: [String: Any]) {
        if let portfolio = data["portfolio"] as? Data { state = try? JSONDecoder().decode(BrokerPortfolioResponse.self, from: portfolio) }
        if let text = data["message"] as? String { message = text }
        if let text = data["error"] as? String { message = text }
        reachable = WCSession.default.isReachable
    }
    func refresh() { send(["refresh": true]) }
    func exit(_ input: BrokerExitInput) { guard let data = try? JSONEncoder().encode(input) else { return }; send(["exit": data]) }
    private func send(_ payload: [String: Any]) {
        reachable = WCSession.default.isReachable
        guard reachable else { message = "Open PolyTheta on your paired iPhone to connect."; return }
        guard !busy else { return }; busy = true
        WCSession.default.sendMessage(payload, replyHandler: { result in Task { @MainActor in self.busy = false; self.receive(result) } }, errorHandler: { error in Task { @MainActor in self.busy = false; self.message = "Request could not be confirmed. Refresh before retrying. \(error.localizedDescription)" } })
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { Task { @MainActor in self.reachable = session.isReachable } }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) { Task { @MainActor in self.reachable = session.isReachable } }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) { Task { @MainActor in self.receive(context) } }
}
struct WatchTradesView: View {
    @EnvironmentObject var connection: WatchBrokerConnection
    @State private var target: BrokerExitInput?
    private var active: [BrokerPosition] { connection.state?.snapshot?.positions.filter { $0.quantity > 0 || $0.workingEntry || $0.status == "Reconciliation required" || $0.lossStop?.triggeredAt != nil } ?? [] }
    private var canAct: Bool { connection.reachable && !connection.busy && connection.state?.isFresh == true && connection.state?.snapshot?.activated == true }
    var body: some View {
        NavigationStack {
            List {
                Section("PolyTheta only") {
                    Text(connection.state?.isFresh == true ? "IB synchronized" : "Stale / disconnected").font(.caption)
                    Text("Open P/L \(brokerMoney(connection.state?.snapshot?.unrealizedPnl))")
                    if let raw = connection.state?.snapshot?.observedAt, let date = BrokerPortfolioResponse.date(raw) { Text(date, style: .time).font(.caption) }
                    Button("Refresh") { connection.refresh() }.disabled(connection.busy)
                    Button("Exit all NOW", role: .destructive) { prepareExit() }.disabled(!canAct || !active.contains { $0.canExit || $0.workingEntry })
                }
                if let message = connection.message { Text(message).font(.footnote) }
                if active.isEmpty { Text("No open PolyTheta trades confirmed").font(.footnote) }
                ForEach(active) { p in
                    Section(p.ticker) {
                        Text("\(p.strike.formatted()) \(p.side) · \(p.expiry)").font(.caption)
                        Text("\(p.quantity) contracts · \(brokerMoney(p.unrealizedPnl))")
                        Text(p.status).font(.caption)
                        if let stop = p.lossStop {
                            Text("Ticker loss stop").font(.caption.bold())
                            Text(stop.message ?? stop.status ?? "Awaiting monitoring").font(.caption)
                            Text("Loss \(brokerMoney(stop.lossAmount)) / limit \(brokerMoney(stop.thresholdAmount))").font(.caption)
                        }
                        Button("Exit NOW", role: .destructive) { prepareExit(conid: p.conid) }.disabled(!canAct || !p.canExit && !p.workingEntry)
                    }
                }
                ForEach(connection.state?.requests ?? []) { r in VStack(alignment: .leading) { Text(r.status); Text(r.message).font(.caption) } }
            }.navigationTitle("PolyTheta")
            .confirmationDialog("Exit PolyTheta trade(s)?", isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }), titleVisibility: .visible) {
                if let target { Button("Exit NOW", role: .destructive) { connection.exit(target) } }
            } message: { Text("The trading Mac submits limit orders. Fills are not guaranteed. Exit all pauses entries.") }
            .task { while !Task.isCancelled { connection.refresh(); do { try await Task.sleep(for: .seconds(15)) } catch { break } } }
        }
    }
    private func prepareExit(conid: Int? = nil) {
        guard canAct, let accountKey = connection.state?.snapshot?.accountKey else { return }
        target = BrokerExitInput(requestId: UUID().uuidString, accountKey: accountKey, scope: conid == nil ? "all" : "position", conid: conid)
    }
}
