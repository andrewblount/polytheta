import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.scenePhase) private var scenePhase
    @State private var basket: MobileBasket?
    @State private var availability: BasketAvailability?
    @State private var error: String?
    @State private var loading = false
    // Price path + analysis per position id, loaded after the basket.
    @State private var legs: [String: LegPath] = [:]

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
                                Text("The published basket has no qualifying positions. Check the Alerts tab for details.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                    }

                    ThesisSection(basket: b)

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
                    if api.isConfigured {
                        Section {
                            Text(availability?.title ?? "No basket published for the current week")
                                .font(.headline)
                            Text(availability?.message ?? "Pull down to refresh. Earlier weeks are available in the Archive tab.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        if let next = availability?.nextScheduled {
                            Section(next.title) {
                                scheduleRow("Research starts", next.preparationLabel)
                                scheduleRow("Final refresh starts", next.finalRefreshLabel)
                                scheduleRow("Entry window", next.entryLabel)
                                Text(next.note).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        if let latest = availability?.latestPublished {
                            Section("Last published · Archive") {
                                NavigationLink {
                                    ArchiveBasketView(slug: latest.slug, weekOf: latest.weekOf)
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Week of \(latest.weekOf)").font(.headline)
                                        Text("Historical basket").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    } else {
                        Text("Add your API token in Settings to connect.").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Current Basket")
            .refreshable { await load() }
            .task { await load() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await load() } }
            }
            .overlay { if loading && basket == nil { ProgressView() } }
        }
    }

    func scheduleRow(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline)
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
                // The underlying against the strike, so a model trade can be
                // watched as the week goes on.
                if let leg = legs[p.id] {
                    LegPathCard(leg: leg)
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
        guard api.isConfigured, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let summary = try await api.summary()
            basket = summary.basket
            availability = summary.availability
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        if let slug = basket?.slug, let response = try? await api.basketLegs(slug: slug) {
            legs = Dictionary(uniqueKeysWithValues: response.legs.map { ($0.positionId, $0) })
        }
    }
}
