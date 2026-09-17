import SwiftUI
struct LiveTradesView: View {
    @EnvironmentObject var api: APIClient
    @State private var state: BrokerPortfolioResponse?
    @State private var error: String?
    @State private var message: String?
    @State private var busy = false
    @State private var exitTarget: BrokerExitInput?
    private var active: [BrokerPosition] { state?.snapshot?.positions.filter { $0.quantity > 0 || $0.workingEntry || $0.status == "Reconciliation required" || $0.lossStop?.triggeredAt != nil } ?? [] }
    private var canAct: Bool { state?.isFresh == true && state?.snapshot?.activated == true && error == nil && !busy }
    var body: some View {
        NavigationStack {
            List {
                Section("PolyTheta only · IB live") {
                    Text(state?.isFresh == true && error == nil ? "IB account synchronized" : "IB connection unavailable or stale").foregroundStyle(state?.isFresh == true ? .secondary : .primary)
                    if let snapshot = state?.snapshot {
                        Text("Last sync: \(snapshot.observedAt)").font(.caption)
                        if !snapshot.activated { Text("Execution service is not activated").font(.caption) }
                        LabeledContent("Unrealized P/L", value: brokerMoney(snapshot.unrealizedPnl))
                        LabeledContent("Realized P/L before fees", value: brokerMoney(snapshot.realizedPnl))
                        LabeledContent("Confirmed fees", value: brokerMoney(snapshot.fees))
                        if !snapshot.complete { Text("Marks, fees or reconciliation are pending.").font(.caption) }
                    }
                    if let error { ErrorBanner(message: error) }
                    if let message { Text(message).font(.footnote) }
                    Button("Exit all NOW", role: .destructive) { prepareExit() }.disabled(!canAct || !active.contains { $0.canExit || $0.workingEntry })
                    Text("Only PolyTheta trades. Exit all also pauses new entries.").font(.caption).foregroundStyle(.secondary)
                }
                if active.isEmpty { Text(state?.snapshot == nil ? "Connect IB on the trading Mac to load holdings." : "No open PolyTheta trades confirmed.") }
                ForEach(active) { p in
                    Section("\(p.ticker) · \(p.strike.formatted()) \(p.side)") {
                        LabeledContent("Expiry", value: p.expiry)
                        LabeledContent("Short contracts", value: String(p.quantity))
                        LabeledContent("Average entry fill", value: brokerMoney(p.averageFill))
                        LabeledContent("IB mark", value: brokerMoney(p.mark))
                        LabeledContent("Unrealized P/L", value: brokerMoney(p.unrealizedPnl))
                        if let stop = p.lossStop {
                            Text("Ticker loss stop").font(.headline)
                            Text(stop.message ?? stop.status ?? "Awaiting worker monitoring").font(.caption)
                            LabeledContent("Ticker loss / limit", value: "\(brokerMoney(stop.lossAmount)) / \(brokerMoney(stop.thresholdAmount))")
                            LabeledContent("Account equity before entry", value: brokerMoney(stop.baselineEquity))
                            if let at = stop.triggeredAt, let date = BrokerPortfolioResponse.date(at) {
                                Text("Triggered: \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption)
                            }
                        }
                        if let pricing = p.entryPricing {
                            DisclosureGroup("Entry price calculation") {
                                LabeledContent("Reference premium", value: brokerMoney(pricing.referenceCredit))
                                LabeledContent("Calendar days elapsed", value: pricing.elapsedCalendarDays.formatted(.number.precision(.fractionLength(2))))
                                LabeledContent("Time effect", value: brokerMoney(pricing.timeEffect))
                                LabeledContent("Underlying effect", value: brokerMoney(pricing.underlyingEffect))
                                LabeledContent("IV effect", value: brokerMoney(pricing.ivEffect))
                                LabeledContent("Adjusted estimate", value: brokerMoney(pricing.credit))
                                Text("\(pricing.ivSource) · IV \((pricing.iv * 100).formatted())%").font(.caption)
                                Text("Reference: \(pricing.observedAt). Estimated: \(pricing.estimatedAt). Actual fill is shown separately.").font(.caption)
                            }
                        }
                        Text(p.status).font(.caption)
                        Button("Exit NOW", role: .destructive) { prepareExit(conid: p.conid) }.disabled(!canAct || !p.canExit && !p.workingEntry)
                    }
                }
                if let requests = state?.requests, !requests.isEmpty {
                    Section("Exit requests") { ForEach(requests) { r in VStack(alignment: .leading) { Text(r.status).font(.headline); Text(r.message).font(.footnote) } } }
                }
                Text("NOW requests prompt processing. Fills require liquidity and an open exchange session; pending requests remain visible until confirmed by IB.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle(state?.snapshot?.mode == "paper" ? "Paper IB trades" : "IB trades")
            .toolbar { Button("Refresh") { Task { await refresh() } } }
            .refreshable { await refresh() }
            .confirmationDialog("Exit PolyTheta trade(s) now?", isPresented: Binding(get: { exitTarget != nil }, set: { if !$0 { exitTarget = nil } }), titleVisibility: .visible) {
                if let target = exitTarget { Button("Confirm exit NOW", role: .destructive) { Task { await sendExit(target) } } }
            } message: { Text("Pending entries will be cancelled first. The trading Mac submits buy-to-close limit orders for confirmed PolyTheta quantities. An immediate fill is not guaranteed.") }
            .task { while !Task.isCancelled { await refresh(); do { try await Task.sleep(for: .seconds(15)) } catch { break } } }
        }
    }
    private func prepareExit(conid: Int? = nil) {
        guard canAct, let accountKey = state?.snapshot?.accountKey else { return }
        exitTarget = BrokerExitInput(requestId: UUID().uuidString, accountKey: accountKey, scope: conid == nil ? "all" : "position", conid: conid)
    }
    private func refresh() async {
        guard api.isConfigured else { error = "Set your API token in Settings."; return }
        do {
            state = try await api.brokerPortfolio(); error = nil
            #if os(iOS)
            if let state { PhoneWatchBridge.shared.publish(state) }
            #endif
        } catch { self.error = error.localizedDescription }
    }
    private func sendExit(_ input: BrokerExitInput) async {
        busy = true; defer { busy = false }
        do { message = try await api.requestBrokerExit(input).message; await refresh() }
        catch { message = error.localizedDescription }
    }
}
