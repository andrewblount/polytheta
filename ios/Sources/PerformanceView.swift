import Charts
import SwiftUI

struct PerformanceView: View {
    @EnvironmentObject var api: APIClient
    @State private var report: PerformanceResponse?
    @State private var error: String?
    // Sizing sliders: the track record is recomputed on the phone from the
    // published legs while a slider moves, and the settings are saved when it
    // is released. `live` is nil until the first change.
    @State private var model = ModelSettings()
    @State private var modelLoaded = false
    @State private var live: ModelPerformance?
    @State private var saveState = ""

    private var stats: Stats? { live?.stats ?? report?.stats }
    private var cumulative: [CumulativePoint]? { live?.cumulative ?? report?.cumulative }
    private var weeks: [WeekRow]? { live?.weeks ?? report?.weeks }
    private var basis: PerformanceBasis? { live?.basis ?? report?.basis }

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) }

                if modelLoaded, report?.source != nil {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack { Text("Account traded"); Spacer(); Text("\(Int(model.accountTradedPct))%").font(.body.monospacedDigit().weight(.semibold)) }
                            Slider(value: $model.accountTradedPct, in: ModelSizing.tradedRange, step: ModelSizing.tradedStep) { Text("Account traded") }
                                minimumValueLabel: { Text("0%").font(.caption2) } maximumValueLabel: { Text("100%").font(.caption2) }
                                onEditingChanged: { editing in if !editing { save() } }
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            HStack { Text("Margin available"); Spacer(); Text("\(Int(model.marginAvailablePct))%").font(.body.monospacedDigit().weight(.semibold)) }
                            Slider(value: $model.marginAvailablePct, in: ModelSizing.marginRange, step: ModelSizing.marginStep) { Text("Margin available") }
                                minimumValueLabel: { Text("100%").font(.caption2) } maximumValueLabel: { Text("1000%").font(.caption2) }
                                onEditingChanged: { editing in if !editing { save() } }
                        }
                        Toggle("Sell calls", isOn: $model.sellCalls).onChange(of: model.sellCalls) { save() }
                        Toggle("Sell puts", isOn: $model.sellPuts).onChange(of: model.sellPuts) { save() }
                    } header: {
                        Text("Model sizing")
                    } footer: {
                        Text(saveState.isEmpty ? "Every historical leg is re-sized as you drag: equity \(money(model.modelEquity)) × \(Int(model.accountTradedPct))% traded × \(Int(model.marginAvailablePct))% margin backs \(money(ModelSizing.backing(model))) per basket. Released settings are saved and size the next basket; the IB account below is real fills." : saveState)
                    }
                    .onChange(of: model.accountTradedPct) { recompute() }
                    .onChange(of: model.marginAvailablePct) { recompute() }
                    .onChange(of: model.sellCalls) { recompute() }
                    .onChange(of: model.sellPuts) { recompute() }
                }

                if let stats {
                    Section {
                        HStack {
                            stat("Total", money(stats.totalPnl), stats.totalPnl >= 0 ? .green : .red)
                            Divider()
                            stat("Weeks", "\(stats.winningWeeks)/\(stats.completeWeeks)", .primary)
                            Divider()
                            stat("Legs OTM", String(format: "%.1f%%", stats.legWinRatePct), .primary)
                        }
                        .frame(maxWidth: .infinity)
                        HStack {
                            stat("Avg win", money(stats.avgWinningWeek), .green)
                            Divider()
                            stat("Avg loss", money(stats.avgLosingWeek), .red)
                            Divider()
                            stat("Max DD", money(stats.maxDrawdown), .red)
                        }
                        .frame(maxWidth: .infinity)
                        if let pf = stats.profitFactor ?? (stats.losingWeeks == 0 && stats.completeWeeks > 0 ? Double.infinity : nil) {
                            HStack {
                                stat("Profit factor", pf.isFinite ? String(format: "%.2f", pf) : "∞", .primary)
                                Divider()
                                stat("Credit kept", pctText(stats.creditCapturePct), (stats.creditCapturePct ?? 0) >= 0 ? .green : .red)
                                Divider()
                                stat("Sharpe", stats.sharpe.map { String(format: "%.2f", $0) } ?? "—", .primary)
                            }
                            .frame(maxWidth: .infinity)
                            HStack {
                                stat("Calls", stats.calls.map { "\(Int($0.winRatePct))% · \(money($0.pnl))" } ?? "—", .primary)
                                Divider()
                                stat("Puts", stats.puts.map { $0.legs > 0 ? "\(Int($0.winRatePct))% · \(money($0.pnl))" : "none" } ?? "—", .primary)
                                Divider()
                                stat("Cushion W/L", "\(pctText(stats.avgCushionWinnersPct, 0)) / \(pctText(stats.avgCushionLosersPct, 0))", .primary)
                            }
                            .frame(maxWidth: .infinity)
                            if let w = stats.worstLeg {
                                Text("Worst leg: \(w.ticker) \(w.side) \(money(w.pnl))\(w.expiryPrice != nil && w.entryPrice != nil && w.strike != nil ? " — \(priceText(w.entryPrice)) → \(priceText(w.expiryPrice)) at expiry vs the \(priceText(w.strike)) strike" : ""). Longest losing streak \(stats.longestLosingStreak ?? 0) wk; \(money(stats.expectancyPerLeg ?? 0)) expectancy per leg; \(pctText(stats.returnOnMarginPct, 2)) on margin.")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text("Modeled — held to expiry or exited on a radar signal")
                    } footer: {
                        if let b = basis, b.sizing == "model", let equity = b.modelEquity {
                            Text("Every leg is sized from the model settings: equity \(money(equity)), \(Int(b.accountTradedPct ?? 100))% traded, \(Int(b.marginAvailablePct ?? 100))% margin available\((b.sellCalls ?? true) ? "" : ", calls off")\((b.sellPuts ?? true) ? "" : ", puts off").")
                        }
                    }
                }

                if let cumulative, !cumulative.isEmpty {
                    Section("Weekly P&L") {
                        Chart(cumulative) { point in
                            BarMark(
                                x: .value("Week", String(point.weekOf.suffix(5))),
                                y: .value("P&L", point.pnl)
                            )
                            .foregroundStyle(point.pnl >= 0 ? Color.green.opacity(0.75) : Color.red.opacity(0.8))
                        }
                        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
                        .frame(height: 220)
                        .padding(.vertical, 8)
                    }
                    Section("Cumulative") {
                        Chart(cumulative) { point in
                            LineMark(
                                x: .value("Week", String(point.weekOf.suffix(5))),
                                y: .value("Cumulative", point.cumulative)
                            )
                            .interpolationMethod(.monotone)
                            AreaMark(
                                x: .value("Week", String(point.weekOf.suffix(5))),
                                y: .value("Cumulative", point.cumulative)
                            )
                            .foregroundStyle(.linearGradient(
                                colors: [.accentColor.opacity(0.3), .clear],
                                startPoint: .top, endPoint: .bottom))
                        }
                        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
                        .frame(height: 180)
                        .padding(.vertical, 8)
                    }
                }

                if report != nil {
                    AccountPerformanceSection(account: report?.account)
                }

                if let weeks {
                    Section("Settled weeks") {
                        // Each settled week opens the full basket: its trades, each
                        // position's outcome and the trading thesis behind it.
                        ForEach(weeks.filter(\.complete).reversed()) { w in
                            NavigationLink {
                                ArchiveBasketView(slug: w.slug, weekOf: w.weekOf)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(w.weekOf).font(.subheadline.weight(.medium))
                                        Text("GSRS \(w.gsrs, specifier: "%.2f") · \(w.wins)/\(w.settledLegs) OTM")
                                            .font(.caption).foregroundStyle(.secondary)
                                        if let worst = w.worstLeg, let entry = worst.entryPrice, let exp = worst.expiryPrice, let k = worst.strike {
                                            // Worst leg's entry → expiry price against its strike.
                                            Text("\(worst.ticker) \(worst.side == "call" ? "C" : "P") \(k, specifier: "%.2f"): \(entry, specifier: "%.2f") → \(exp, specifier: "%.2f") at expiry")
                                                .font(.caption2).foregroundStyle(worst.pnl < 0 ? .red : .secondary)
                                        }
                                    }
                                    Spacer()
                                    Text(money(w.pnl))
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(w.pnl >= 0 ? .green : .red)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Performance")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold)).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
    }

    func load() async {
        guard api.isConfigured else { return }
        do {
            report = try await api.performance()
            live = nil
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        if !modelLoaded, let m = try? await api.getBrokerSettings().model {
            model = m
            modelLoaded = true
        }
    }

    func recompute() {
        guard let source = report?.source else { return }
        live = ModelSizing.compute(source, model: model)
    }

    func save() {
        let snapshot = model
        saveState = "Saving model settings…"
        Task {
            do {
                let saved = try await api.updateModelSettings(snapshot)
                // Only the latest release lands; an older response never overwrites a newer drag.
                if model == snapshot { model = saved; saveState = "Saved — the model uses these settings." }
            } catch {
                saveState = "Not saved: \(error.localizedDescription)"
            }
        }
    }
}
