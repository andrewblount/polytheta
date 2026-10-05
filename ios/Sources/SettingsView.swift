import SwiftUI

private enum SettingsPanel: String, CaseIterable, Identifiable {
    case connection = "Connection", model = "Model", trading = "Trading", notifications = "Notifications"
    var id: String { rawValue }
    var subtitle: String {
        switch self {
        case .connection: return "Connect this app to your Polytheta account."
        case .model: return "Size the weekly model and explore its track record."
        case .trading: return "Manage execution, account limits, and broker connectivity."
        case .notifications: return "Choose where briefings and trading alerts reach you."
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var api: APIClient
    @State private var panel = SettingsPanel.connection
    @State private var testResult: String?
    @State private var testing = false
    @State private var notifications: [String: [String: Bool]] = [:]
    @State private var notificationsLoaded = false
    @State private var settingsError: String?
    #if os(macOS)
    @StateObject private var push = MacPushNotifications.shared
    #endif

    private let categories: [(key: String, label: String)] = [
        ("briefing_open", "Open briefing · 9:45 ET"),
        ("briefing_close", "Close briefing · 4:10 ET"),
        ("radar_alerts", "Radar exit signals"),
        ("adverse_move", "Adverse-move heads-ups"),
    ]

    var body: some View {
        ScreenNavigation {
            #if os(macOS)
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(panel.rawValue).font(.title2.weight(.semibold))
                    Picker("Settings panel", selection: $panel) {
                        ForEach(SettingsPanel.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .accessibilityIdentifier("settings.panels")
                    Text(panel.subtitle).font(.subheadline).foregroundStyle(.secondary)
                }.padding(24)
                Form { sections }
                    .formStyle(.grouped)
            }
            .navigationTitle("Settings")
            .loadOnAppearance { await loadSettings() }
            .onChange(of: api.token) { Task { await loadSettings() } }
            #else
            Form { sections }
                .navigationTitle("Settings")
                .task(id: api.token) { await loadSettings() }
            #endif
        }
    }

    private func shows(_ requested: SettingsPanel) -> Bool {
        #if os(macOS)
        return panel == requested
        #else
        return true
        #endif
    }

    @ViewBuilder private var sections: some View {
        if shows(.connection) { connectionSection }
        if shows(.model) { ModelSettingsSection() }
        if shows(.trading) { BrokerSettingsSection() }
        if shows(.notifications) { notificationSections }
    }

    private var connectionSection: some View {
        Section {
            SettingRow("Base URL") {
                TextField("Base URL", text: $api.baseURL)
                    #if os(iOS)
                    .keyboardType(.URL)
                    #endif
            }
            SettingRow("API token") { SecureField("API token", text: $api.token) }
            HStack(spacing: 12) {
                Button(testing ? "Testing…" : "Test connection") { Task { await testConnection() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(!api.isConfigured || testing)
                if testing { ProgressView().controlSize(.small) }
            }
            if let testResult { Text(testResult).font(.footnote).foregroundStyle(.secondary) }
        } header: { Label("Connection", systemImage: "network") }
        footer: { Text("Your API token is stored in this device’s Keychain. Data is modeled from recommended entries; verify against live broker chains before trading.") }
    }

    @ViewBuilder private var notificationSections: some View {
        #if os(macOS)
        Section("On this Mac") {
            Text(push.status).font(.footnote).foregroundStyle(.secondary)
            Button("Enable Mac notifications") { Task { await push.enable() } }
                .disabled(push.busy)
        }.task(id: api.token) { await push.refresh() }
        #endif
        if let settingsError {
            Section {
                ErrorBanner(message: settingsError)
                Button("Retry loading notifications") { Task { await loadSettings() } }
            }
        }
        if !notificationsLoaded && settingsError == nil && api.isConfigured {
            Section { ProgressView("Loading notification preferences…") }
        }
        ForEach(categories, id: \.key) { category in
            Section {
                channelToggle(category.key, "email", "Email")
                channelToggle(category.key, "imessage", "iMessage")
                channelToggle(category.key, "sms", "SMS")
                channelToggle(category.key, "whatsapp", "WhatsApp")
            } header: { Text(category.label) }
            .disabled(!notificationsLoaded)
        }
        Section {
            Text("SMS and WhatsApp go through Twilio to your mobile. WhatsApp also needs the Twilio sandbox activated and joined from WhatsApp. Changes apply to the next scheduled send.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func channelToggle(_ category: String, _ channel: String, _ label: String) -> some View {
        Toggle(label, isOn: Binding(
            get: { notifications[category]?[channel] ?? false },
            set: { value in
                notifications[category, default: [:]][channel] = value
                Task { await saveSettings(category: category, channel: channel, value: value) }
            }
        ))
        .toggleStyle(.switch)
        .accessibilityIdentifier("\(category).\(channel)")
    }

    private func testConnection() async {
        testing = true
        defer { testing = false }
        do {
            let summary = try await api.summary()
            testResult = summary.basket.map { "Connected · current basket \($0.weekOf)" } ?? "Connected · no basket published for the current week."
            await loadSettings()
        } catch { testResult = "Connection failed: \(error.localizedDescription)" }
    }

    private func loadSettings() async {
        notificationsLoaded = false
        guard api.isConfigured else { return }
        do {
            notifications = try await api.getSettings()
            notificationsLoaded = true
            settingsError = nil
        } catch { settingsError = error.localizedDescription }
    }

    private func saveSettings(category: String, channel: String, value: Bool) async {
        do {
            _ = try await api.updateSetting(category: category, channel: channel, value: value)
            settingsError = nil
        } catch {
            settingsError = error.localizedDescription
            await loadSettings()
        }
    }
}
