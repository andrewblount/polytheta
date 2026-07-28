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
    @State private var notifications: [String: [String: Bool]] = [:]
    @State private var settingsError: String?

    let categories: [(key: String, label: String)] = [
        ("briefing_open", "Open briefing (9:45 ET)"),
        ("briefing_close", "Close briefing (4:10 ET)"),
        ("radar_alerts", "Radar exit signals"),
        ("adverse_move", "Adverse-move heads-ups"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Base URL", text: $api.baseURL)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .autocorrectionDisabled()
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
                Section("Notifications") {
                    if let settingsError { ErrorBanner(message: settingsError) }
                    ForEach(categories, id: \.key) { cat in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(cat.label).font(.subheadline.weight(.medium))
                            HStack(spacing: 14) {
                                channelToggle(cat.key, "email", "Email")
                                channelToggle(cat.key, "imessage", "iMessage")
                            }
                            HStack(spacing: 14) {
                                channelToggle(cat.key, "sms", "SMS")
                                channelToggle(cat.key, "whatsapp", "WhatsApp")
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    Text("SMS and WhatsApp go through Twilio to your mobile. WhatsApp also needs the Twilio sandbox activated and joined from WhatsApp. Changes apply to the next scheduled send.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Section {
                    Text("Data is modeled from recommended entries. Verify everything against live broker chains before trading.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .task { await loadSettings() }
        }
    }

    @ViewBuilder
    func channelToggle(_ category: String, _ channel: String, _ label: String) -> some View {
        Toggle(label, isOn: Binding(
            get: { notifications[category]?[channel] ?? true },
            set: { newValue in
                notifications[category, default: [:]][channel] = newValue
                Task { await saveSettings(category: category, channel: channel, value: newValue) }
            }
        ))
        .font(.caption)
        .toggleStyle(.switch)
    }

    func loadSettings() async {
        guard api.isConfigured else { return }
        do {
            notifications = try await api.getSettings()
            settingsError = nil
        } catch { settingsError = error.localizedDescription }
    }

    func saveSettings(category: String, channel: String, value: Bool) async {
        do {
            notifications = try await api.updateSetting(category: category, channel: channel, value: value)
            settingsError = nil
        } catch { settingsError = error.localizedDescription }
    }
}
