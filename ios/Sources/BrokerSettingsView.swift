import SwiftUI

struct BrokerSettings: Codable {
    var connection = "tws"
    var pauseEntries = true
    var entryCapitalPct = 100.0
    var callAllocationPct = 100.0
    var putAllocationPct = 0.0
    var maxTrades = 8
    var reserveLeverageCeiling = 4.0
    var minimumCreditRatio = 0.9
    var entryTimeoutSeconds = 300.0
    var maxExitPremiumMultiple = 1.5
    var excludedTickers = ["TSLA", "SPCX"]
    var strikeOverrides: [StrikeOverride] = []
}
struct StrikeOverride: Codable { var ticker = ""; var side = "call"; var expiry = ""; var minimumOtmPct = 5.0 }
struct BrokerSettingsResponse: Codable {
    let broker: BrokerSettings
    let brokerStatus: BrokerStatus?
    struct BrokerStatus: Codable { let message: String?; let stale: Bool? }
}
struct BrokerSettingsSection: View {
    @EnvironmentObject var api: APIClient
    @State private var settings = BrokerSettings()
    @State private var loaded = false
    @State private var saving = false
    @State private var message = "IB connection has not been verified."
    @State private var error: String?
    @State private var newExcludedTicker = ""
    var body: some View {
        Section("Interactive Brokers · Live") {
            Text(message).font(.footnote).foregroundStyle(.secondary)
            Picker("Connection", selection: $settings.connection) {
                Text("TWS / IB Gateway").tag("tws")
                Text("IB Web API").tag("web-api")
            }
            LabeledContent("Total allocation (%)") { TextField("Percent", value: $settings.entryCapitalPct, format: .number).multilineTextAlignment(.trailing) }
            LabeledContent("Calls (%)") { TextField("Percent", value: $settings.callAllocationPct, format: .number).multilineTextAlignment(.trailing) }
            LabeledContent("Puts (%)") { TextField("Percent", value: $settings.putAllocationPct, format: .number).multilineTextAlignment(.trailing) }
            Stepper("Maximum trades: \(settings.maxTrades)", value: $settings.maxTrades, in: 1...20)
            LabeledContent("Gross exposure / equity ceiling (×)") { TextField("Multiple", value: $settings.reserveLeverageCeiling, format: .number).multilineTextAlignment(.trailing) }
            LabeledContent("Minimum credit / model") { TextField("Ratio", value: $settings.minimumCreditRatio, format: .number).multilineTextAlignment(.trailing) }
            LabeledContent("Exit debit ceiling / initial ask") { TextField("Multiple", value: $settings.maxExitPremiumMultiple, format: .number) }
            Toggle("Pause new entries", isOn: $settings.pauseEntries)
            Text("Do not trade").font(.headline)
            ForEach(settings.excludedTickers, id: \.self) { ticker in
                HStack { Text(ticker == "SPCX" ? "SPCX · SpaceX" : ticker); Spacer(); Button("Remove") { settings.excludedTickers.removeAll { $0 == ticker } } }
            }
            HStack {
                TextField("Ticker to exclude", text: $newExcludedTicker)
                Button("Add") { let ticker = newExcludedTicker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(); if !ticker.isEmpty && !settings.excludedTickers.contains(ticker) { settings.excludedTickers.append(ticker) }; newExcludedTicker = "" }
            }
            Text("Exclusions block new entries. Existing trades can still exit.").font(.caption).foregroundStyle(.secondary)
            Text("Per-trade minimum OTM").font(.headline)
            ForEach(settings.strikeOverrides.indices, id: \.self) { i in
                VStack(alignment: .leading) {
                    TextField("Ticker", text: $settings.strikeOverrides[i].ticker)
                    Picker("Side", selection: $settings.strikeOverrides[i].side) { Text("Call").tag("call"); Text("Put").tag("put") }
                    TextField("Expiry (YYYY-MM-DD)", text: $settings.strikeOverrides[i].expiry)
                    LabeledContent("At least OTM (%)") { TextField("Minimum", value: $settings.strikeOverrides[i].minimumOtmPct, format: .number) }
                    Button("Remove trade minimum", role: .destructive) { settings.strikeOverrides.remove(at: i) }
                }
            }
            Button("Add trade minimum") { settings.strikeOverrides.append(StrikeOverride()) }
            Text("Set before building the basket. Available strikes must meet this minimum plus delta and ATR rules. Existing positions are unchanged.").font(.caption).foregroundStyle(.secondary)
            Text("Calls and puts must total 100%. The split determines trade counts; capital is divided equally. No doubling. IB real-time quotes are required. The margin reserve does not increase entry size.").font(.caption).foregroundStyle(.secondary)
            if let error { ErrorBanner(message: error) }
            Button(saving ? "Saving…" : "Save trading settings") {
                Task {
                    saving = true
                    defer { saving = false }
                    do { settings = try await api.updateBrokerSettings(settings); error = nil; message = "Trading settings saved. Live execution requires activation on the trading Mac." }
                    catch { self.error = error.localizedDescription }
                }
            }.disabled(!loaded || saving)
            if let url = URL(string: api.baseURL + "/trading-rules") { Link("Entry, exit and GSRS rules", destination: url) }
        }.task {
            guard api.isConfigured else { return }
            do {
                let response = try await api.getBrokerSettings()
                settings = response.broker; loaded = true
                message = response.brokerStatus?.stale == false ? response.brokerStatus?.message ?? "IB status unavailable" : "IB connection has not been verified recently."
            } catch { self.error = error.localizedDescription }
        }
    }
}
