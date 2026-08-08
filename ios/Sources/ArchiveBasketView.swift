import SwiftUI

// A historical basket, opened from the Archive. Every position drills into
// the same decision card the current basket uses, so a past trade can be read
// back with the reasoning that produced it — and, once settled, the outcome
// next to that reasoning.
struct ArchiveBasketView: View {
    @EnvironmentObject var api: APIClient
    let slug: String
    let weekOf: String

    @State private var basket: MobileBasket?
    @State private var error: String?
    @State private var loading = false

    var settledPnl: Double? {
        guard let basket else { return nil }
        let legs = basket.allPositions.compactMap(\.latest)
        guard !legs.isEmpty else { return nil }
        return legs.reduce(0) { $0 + $1.pnlAmount }
    }

    var body: some View {
        List {
            if let error { ErrorBanner(message: error) }

            if let b = basket {
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("GSRS").font(.caption).foregroundStyle(.secondary)
                            Text(String(format: "%.2f", b.gsrs))
                                .font(.title2.weight(.bold))
                                .foregroundStyle(b.gsrs < 3 ? .green : b.gsrs < 5 ? .yellow : .red)
                        }
                        Spacer()
                        if let pnl = settledPnl {
                            VStack(alignment: .trailing, spacing: 4) {
                                Text("Result").font(.caption).foregroundStyle(.secondary)
                                Text(money(pnl))
                                    .font(.title3.weight(.bold))
                                    .foregroundStyle(pnl >= 0 ? .green : .red)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                    NavigationLink("Why this basket — decisions & signals") {
                        BasketDecisionView(basket: b)
                    }
                    .font(.footnote.weight(.medium))
                } header: {
                    Text(b.title)
                } footer: {
                    Text("Tap any position for the signals and screen checks behind it.")
                }

                positionSection("Calls", b.calls)
                positionSection("Puts", b.puts)

                Section("Market at entry") {
                    LabeledContent("VIX", value: String(format: "%.2f", b.market.vix))
                    LabeledContent("SKEW", value: String(format: "%.0f", b.market.skew))
                    LabeledContent("HY OAS", value: String(format: "%.2f%%", b.market.hyOas))
                    LabeledContent("MOVE", value: String(format: "%.0f", b.market.move))
                    LabeledContent("P/C", value: String(format: "%.2f", b.market.putCallRatio))
                }
            } else if loading {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
        .navigationTitle(weekOf)
        .task { await load() }
        .refreshable { await load() }
    }

    func positionSection(_ title: String, _ positions: [MobilePosition]) -> some View {
        Section(title) {
            if positions.isEmpty {
                Text("None this week").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(positions) { p in
                NavigationLink {
                    PositionDecisionView(position: p)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(p.ticker).font(.subheadline.weight(.semibold))
                            Text("\(p.side == "call" ? "C" : "P") $\(p.strike, specifier: "%.2f")")
                                .font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            if let l = p.latest { StateBadge(state: l.state) }
                        }
                        HStack {
                            Text("\(p.contracts)x @ \(p.entryCredit, specifier: "%.2f")")
                                .font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            if let l = p.latest {
                                Text(money(l.pnlAmount))
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(l.pnlAmount >= 0 ? .green : .red)
                            }
                        }
                    }
                }
            }
        }
    }

    func load() async {
        guard api.isConfigured else { return }
        loading = true
        defer { loading = false }
        do {
            basket = try await api.basket(slug: slug)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
