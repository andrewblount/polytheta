import SwiftUI

// The trading thesis for a basket: what the model saw, why the rules picked
// these contracts, and how the account is expected to differ from the model.
// Shown inline on every historical basket and on the current one.
struct ThesisSection: View {
    let basket: MobileBasket
    @State private var expanded = false

    var body: some View {
        Section {
            if let model = basket.model {
                HStack(spacing: 8) {
                    Text(model.provenanceLabel)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background((model.provenance == "live-snapshot" ? Color.green : Color.orange).opacity(0.18))
                        .clipShape(Capsule())
                    if model.late {
                        Text("Late model entry +\(model.lateMinutes) min")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.yellow.opacity(0.2))
                            .clipShape(Capsule())
                    }
                    if let equity = model.modelEquity {
                        Text("Model \(money(equity))")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                if let note = model.reconstructionNote {
                    Text(note).font(.caption).foregroundStyle(.orange)
                }
            }
            if let thesis = basket.thesis {
                Text(thesis.headline).font(.subheadline.weight(.semibold))
                block("Market regime", thesis.regime)
                if expanded {
                    block("Selection", thesis.selection)
                    ForEach(thesis.picks) { pick in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(pick.ticker) · \(pick.side == "call" ? "short call" : "short put") \(pick.strike, specifier: "%g")")
                                .font(.caption.weight(.semibold))
                            Text(pick.text).font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                    block("Risk and exits", thesis.risk)
                    block("Model versus execution", thesis.execution)
                }
                Button(expanded ? "Show less" : "Full thesis, every name") { withAnimation { expanded.toggle() } }
                    .font(.footnote.weight(.medium))
            } else {
                Text("No thesis was stored for this basket. The web archive can backfill it from the stored selection data.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } header: {
            Text("Trading thesis")
        }
    }

    func block(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            Text(text).font(.caption)
        }
        .padding(.vertical, 2)
    }
}

// Account track on the Performance tab: IB fills against the model.
struct AccountPerformanceSection: View {
    let account: AccountPerformance?

    func signed(_ n: Double?) -> String {
        guard let n else { return "n/a" }
        return (n >= 0 ? "+" : "\u{2212}") + money(abs(n))
    }

    var body: some View {
        if let tracks = account?.accounts, !tracks.isEmpty {
            ForEach(tracks) { track in
                Section {
                    HStack {
                        stat("Actual", signed(track.totals.actualPnl), track.totals.actualPnl >= 0 ? .green : .red)
                        Divider()
                        stat("Model, same size", signed(track.totals.modeledPnlAtAccountSize), .primary)
                        Divider()
                        stat("Executed", String(format: "%.0f%%", track.totals.executionRatePct), .primary)
                    }
                    .frame(maxWidth: .infinity)
                    HStack {
                        stat("Slippage", signed(track.totals.slippageTotal), track.totals.slippageTotal >= 0 ? .green : .red)
                        Divider()
                        stat("Fees", money(track.totals.fees), .primary)
                        Divider()
                        stat("Per contract", track.totals.avgSlippagePerContract.map { String(format: "%+.3f", $0) } ?? "n/a", .primary)
                    }
                    .frame(maxWidth: .infinity)
                    ForEach(track.weeks.reversed()) { week in
                        NavigationLink {
                            ArchiveBasketView(slug: week.slug, weekOf: week.weekOf)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(week.weekOf).font(.subheadline.weight(.medium))
                                    if !week.complete { Text("in progress").font(.caption2).foregroundStyle(.secondary) }
                                    Spacer()
                                    Text(signed(week.actualPnl))
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle((week.actualPnl ?? 0) >= 0 ? .green : .red)
                                }
                                Text("\(week.executedLegs)/\(week.modelLegs) legs · model \(signed(week.modeledPnl)) · same size \(signed(week.modeledPnlAtAccountSize)) · slippage \(signed(week.slippageTotal))")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("IB \(track.mode) account — actual vs model")
                } footer: {
                    Text("Fills and fees from the execution service. Expired shorts without a closing fill settle at the model's expiry intrinsic value until reconciled at IB.")
                }
            }
        } else {
            Section("IB account — actual vs model") {
                Text("No IB fills yet. Once the execution service enters a published model basket, execution rate, slippage and actual P&L appear here per account.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 4) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.bold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }
}
