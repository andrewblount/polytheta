import SwiftUI

struct AlertsView: View {
    @EnvironmentObject var api: APIClient
    @State private var alerts: [AlertItem] = []
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) }

                if alerts.isEmpty && loaded && error == nil {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No alerts in the last 3 days")
                            .font(.subheadline.weight(.medium))
                        Text("Radar exit signals and adverse-move heads-ups appear here, and reach you by email and iMessage the moment they fire.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                ForEach(alerts.reversed()) { alert in
                    HStack(alignment: .top, spacing: 10) {
                        Text(alert.meta?.kind == "radar" ? "🚨" : "⚠️")
                            .font(.title3)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(alert.message)
                                .font(.subheadline)
                                .lineLimit(4)
                            Text(relativeTime(alert.at))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            .navigationTitle("Alerts")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    func relativeTime(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: iso)
            ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }

    func load() async {
        guard api.isConfigured else { return }
        do {
            alerts = try await api.alerts().alerts
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}
