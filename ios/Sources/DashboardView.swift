import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var api: APIClient
    @State private var basket: MobileBasket?
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) }

                if let b = basket {
                    Section {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("GSRS").font(.caption).foregroundStyle(.secondary)
                                Text(String(format: "%.2f", b.gsrs))
                                    .font(.system(size: 34, weight: .bold, design: .rounded))
                                    .foregroundStyle(gsrsColor(b.gsrs))
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 4) {
                                Text("Est. credit").font(.caption).foregroundStyle(.secondary)
                                Text(money(Double(b.metrics.totalEstimatedCredit)))
                                    .font(.title3.weight(.semibold))
                                Text("margin \(money(Double(b.metrics.totalMargin)))")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                        Text(b.metrics.gsrsConstraintNote)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        NavigationLink("Why this basket — decisions & signals") {
                            BasketDecisionView(basket: b)
                        }
                        .font(.footnote.weight(.medium))
                    } header: {
                        Text(b.title)
                    }

                    if b.allPositions.isEmpty {
                        Section {
                            VStack(alignment: .leading, spacing: 6) {
                                Label("No tradable picks in this basket", systemImage: "exclamationmark.octagon.fill")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.red)
                                Text("The Monday build published no positions — either the pipeline failed or nothing passed the screens. Check the Alerts tab and your email before trading anything.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                    } else {
                        Section("Today's orders — tap to copy") {
                            ForEach(b.allPositions) { p in
                                let line = orderLine(p, expiry: p.expiry)
                                Button {
                                    copyToClipboard(line)
                                } label: {
                                    HStack {
                                        Text(line)
                                            .font(.system(.caption, design: .monospaced))
                                            .foregroundStyle(.primary)
                                            .multilineTextAlignment(.leading)
                                        Spacer()
                                        Image(systemName: "doc.on.doc").font(.caption)
                                    }
                                }
                            }
                            Button {
                                copyToClipboard(b.allPositions.map { orderLine($0, expiry: $0.expiry) }.joined(separator: "\n"))
                            } label: {
                                Label("Copy all orders", systemImage: "doc.on.doc.fill")
                                    .font(.caption.weight(.semibold))
                            }
                        }
                    }

                    positionSection("Calls", b.calls)
                    positionSection("Puts", b.puts)

                    Section("Market") {
                        LabeledContent("VIX", value: String(format: "%.2f", b.market.vix))
                        LabeledContent("SKEW", value: String(format: "%.0f", b.market.skew))
                        LabeledContent("HY OAS", value: String(format: "%.2f%%", b.market.hyOas))
                        LabeledContent("MOVE", value: String(format: "%.0f", b.market.move))
                        LabeledContent("P/C", value: String(format: "%.2f", b.market.putCallRatio))
                    }
                } else if !loading && error == nil {
                    Text(api.isConfigured ? "No published basket." : "Add your API token in Settings to connect.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Current Basket")
            .refreshable { await load() }
            .task { await load() }
            .overlay { if loading && basket == nil { ProgressView() } }
        }
    }

    func positionSection(_ title: String, _ positions: [MobilePosition]) -> some View {
        Section(title) {
            ForEach(positions) { p in
                NavigationLink {
                    PositionDecisionView(position: p)
                } label: {
                    positionRow(p)
                }
            }
        }
    }

    func positionRow(_ p: MobilePosition) -> some View {
        VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(p.ticker).font(.headline)
                        Text("\(p.side == "call" ? "C" : "P") $\(p.strike, specifier: "%.2f")")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Spacer()
                        if let l = p.latest { StateBadge(state: l.state) }
                    }
                    HStack {
                        if let l = p.latest {
                            Text("\(money(l.pnlAmount)) P&L")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(l.pnlAmount >= 0 ? .green : .red)
                            Spacer()
                            Text("\(Int(l.creditCapturePct * 100))% captured · \(l.daysToExpiry)d")
                                .font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text("\(p.contracts)x @ \(p.entryCredit, specifier: "%.2f")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if p.stopBreach == true {
                        Label("Past stop level — check news (policy: hold to expiry)", systemImage: "exclamationmark.octagon.fill")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.red)
                    }
                    if !p.cautionFlags.isEmpty {
                        Text(p.cautionFlags.joined(separator: " · "))
                            .font(.caption2)
                            .foregroundStyle(.orange)
                            .lineLimit(2)
                    }
        }
        .padding(.vertical, 2)
    }

    func gsrsColor(_ g: Double) -> Color {
        if g < 3 { return .green }
        if g < 5 { return .yellow }
        return .red
    }

    func load() async {
        guard api.isConfigured else { return }
        loading = true
        defer { loading = false }
        do {
            basket = try await api.summary().basket
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
