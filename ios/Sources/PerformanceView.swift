import Charts
import SwiftUI

struct PerformanceView: View {
    @EnvironmentObject var api: APIClient
    @State private var report: PerformanceResponse?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) }

                if let stats = report?.stats {
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
                    } header: {
                        Text("Modeled — held to expiry, no stops or doubles")
                    }
                }

                if let cumulative = report?.cumulative, !cumulative.isEmpty {
                    Section("Weekly P&L") {
                        Chart(cumulative) { point in
                            BarMark(
                                x: .value("Week", String(point.weekOf.suffix(5))),
                                y: .value("P&L", point.pnl)
                            )
                            .foregroundStyle(point.pnl >= 0 ? Color.green.opacity(0.75) : Color.red.opacity(0.8))
                        }
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
                        .frame(height: 180)
                        .padding(.vertical, 8)
                    }
                }

                if let weeks = report?.weeks {
                    Section("Settled weeks") {
                        ForEach(weeks.filter(\.complete).reversed()) { w in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(w.weekOf).font(.subheadline.weight(.medium))
                                    Text("GSRS \(w.gsrs, specifier: "%.2f") · \(w.wins)/\(w.settledLegs) OTM")
                                        .font(.caption).foregroundStyle(.secondary)
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
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
