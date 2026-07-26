import SwiftUI

struct ArchiveView: View {
    @EnvironmentObject var api: APIClient
    @State private var baskets: [BasketListItem] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) }
                ForEach(baskets) { b in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(b.weekOf).font(.subheadline.weight(.medium))
                            Text("\(b.names) names · GSRS \(b.gsrs, specifier: "%.2f")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text(money(Double(b.totalEstimatedCredit)))
                                .font(.subheadline.weight(.semibold))
                            Text(b.status)
                                .font(.caption2)
                                .foregroundStyle(b.status == "published" ? .green : .secondary)
                        }
                    }
                }
            }
            .navigationTitle("Archive")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    func load() async {
        guard api.isConfigured else { return }
        do {
            baskets = try await api.baskets().baskets
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var api: APIClient
    @State private var testResult: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Base URL", text: $api.baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("API token", text: $api.token)
                }
                Section {
                    Button("Test connection") {
                        Task {
                            do {
                                let s = try await api.summary()
                                testResult = s.basket != nil
                                    ? "Connected — current basket: \(s.basket!.weekOf)"
                                    : "Connected — no published basket."
                            } catch {
                                testResult = "Failed: \(error.localizedDescription)"
                            }
                        }
                    }
                    if let testResult {
                        Text(testResult).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section {
                    Text("Data is modeled from recommended entries. Verify everything against live broker chains before trading.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
