import SwiftUI

struct BrokerSettings: Codable {
    var connection = "tws"
    var accountMode = "live"
    var pauseEntries = true
    var entryCapitalPct = 100.0
    var marginAvailablePct = 400.0
    var sellCalls = true
    var sellPuts = true
    var maxAccountLossPct = 20.0
    var callAllocationPct = 100.0
    var putAllocationPct = 0.0
    var maxTrades = 8
    var reserveLeverageCeiling = 4.0
    var minimumCreditRatio = 0.9
    var entryTimeoutSeconds = 300.0
    var maxExitPremiumMultiple = 1.5
    var excludedTickers = ["TSLA", "SPCX"]
    var strikeOverrides: [StrikeOverride] = []
    var executionHostId = ""
    var twsHost = "127.0.0.1"
    var twsPort = 4001
    var twsClientId = 96
    var webApiUrl = "https://localhost:5000/v1/api"
    var twsRestartTime = "23:45"
    var twsRestartTimezone = "America/New_York"
    var twsRestartGraceMinutes = 10
    var entryTiming = "monday-morning"
    var mondayEntryStart = "09:45"
    var mondayEntryEnd = "10:30"
    var preparationLeadMinutes = 90
    var finalizeLeadMinutes = 10
    var vixIvSensitivity = 1.0
    var modelRiskFreeRatePct = 4.0

    init() {}
    enum CodingKeys: String, CodingKey {
        case connection, accountMode, pauseEntries, entryCapitalPct, marginAvailablePct, sellCalls, sellPuts, maxAccountLossPct, callAllocationPct, putAllocationPct, maxTrades
        case reserveLeverageCeiling, minimumCreditRatio, entryTimeoutSeconds, maxExitPremiumMultiple, excludedTickers, strikeOverrides
        case executionHostId, twsHost, twsPort, twsClientId, webApiUrl, twsRestartTime, twsRestartTimezone, twsRestartGraceMinutes
        case entryTiming, mondayEntryStart, mondayEntryEnd, preparationLeadMinutes, finalizeLeadMinutes, vixIvSensitivity, modelRiskFreeRatePct
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        connection = try values.decode(String.self, forKey: .connection)
        accountMode = try values.decodeIfPresent(String.self, forKey: .accountMode) ?? accountMode
        pauseEntries = try values.decode(Bool.self, forKey: .pauseEntries)
        entryCapitalPct = try values.decode(Double.self, forKey: .entryCapitalPct)
        callAllocationPct = try values.decode(Double.self, forKey: .callAllocationPct)
        putAllocationPct = try values.decode(Double.self, forKey: .putAllocationPct)
        maxTrades = try values.decode(Int.self, forKey: .maxTrades)
        reserveLeverageCeiling = try values.decode(Double.self, forKey: .reserveLeverageCeiling)
        minimumCreditRatio = try values.decode(Double.self, forKey: .minimumCreditRatio)
        entryTimeoutSeconds = try values.decode(Double.self, forKey: .entryTimeoutSeconds)
        excludedTickers = try values.decode([String].self, forKey: .excludedTickers)
        strikeOverrides = try values.decode([StrikeOverride].self, forKey: .strikeOverrides)
        // New controls are absent from older server responses during rollout.
        // Keep their defaults while still requiring the established core contract.
        maxExitPremiumMultiple = try values.decodeIfPresent(Double.self, forKey: .maxExitPremiumMultiple) ?? maxExitPremiumMultiple
        maxAccountLossPct = try values.decodeIfPresent(Double.self, forKey: .maxAccountLossPct) ?? maxAccountLossPct
        marginAvailablePct = try values.decodeIfPresent(Double.self, forKey: .marginAvailablePct) ?? marginAvailablePct
        sellCalls = try values.decodeIfPresent(Bool.self, forKey: .sellCalls) ?? sellCalls
        sellPuts = try values.decodeIfPresent(Bool.self, forKey: .sellPuts) ?? sellPuts
        executionHostId = try values.decodeIfPresent(String.self, forKey: .executionHostId) ?? executionHostId
        twsHost = try values.decodeIfPresent(String.self, forKey: .twsHost) ?? twsHost
        twsPort = try values.decodeIfPresent(Int.self, forKey: .twsPort) ?? twsPort
        twsClientId = try values.decodeIfPresent(Int.self, forKey: .twsClientId) ?? twsClientId
        webApiUrl = try values.decodeIfPresent(String.self, forKey: .webApiUrl) ?? webApiUrl
        twsRestartTime = try values.decodeIfPresent(String.self, forKey: .twsRestartTime) ?? twsRestartTime
        twsRestartTimezone = try values.decodeIfPresent(String.self, forKey: .twsRestartTimezone) ?? twsRestartTimezone
        twsRestartGraceMinutes = try values.decodeIfPresent(Int.self, forKey: .twsRestartGraceMinutes) ?? twsRestartGraceMinutes
        entryTiming = try values.decodeIfPresent(String.self, forKey: .entryTiming) ?? entryTiming
        mondayEntryStart = try values.decodeIfPresent(String.self, forKey: .mondayEntryStart) ?? mondayEntryStart
        mondayEntryEnd = try values.decodeIfPresent(String.self, forKey: .mondayEntryEnd) ?? mondayEntryEnd
        preparationLeadMinutes = try values.decodeIfPresent(Int.self, forKey: .preparationLeadMinutes) ?? preparationLeadMinutes
        finalizeLeadMinutes = try values.decodeIfPresent(Int.self, forKey: .finalizeLeadMinutes) ?? finalizeLeadMinutes
        vixIvSensitivity = try values.decodeIfPresent(Double.self, forKey: .vixIvSensitivity) ?? vixIvSensitivity
        modelRiskFreeRatePct = try values.decodeIfPresent(Double.self, forKey: .modelRiskFreeRatePct) ?? modelRiskFreeRatePct
    }
}
struct StrikeOverride: Codable { var ticker = ""; var side = "call"; var expiry = ""; var minimumOtmPct = 5.0 }
// The model's own sizing (app_settings 'model'). Changing it re-sizes every
// historical leg in the model performance report; the IB account is untouched.
struct ModelSettings: Codable, Equatable {
    var modelEquity = 1000000.0
    var accountTradedPct = 100.0
    var marginAvailablePct = 400.0
    var sellCalls = true
    var sellPuts = true
}
struct BrokerSettingsResponse: Codable {
    let broker: BrokerSettings
    let model: ModelSettings?
    let brokerStatus: BrokerStatus?
    let executionHosts: [ExecutionHost]?
    struct ExecutionHost: Codable, Identifiable { let id: String; let label: String; let lastSeen: String }
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
    @State private var hosts: [BrokerSettingsResponse.ExecutionHost] = []
    var body: some View {
        Section(settings.accountMode == "paper" ? "Interactive Brokers · Paper" : "Interactive Brokers · Live") {
            Text(message).font(.footnote).foregroundStyle(.secondary)
            Picker("Account mode", selection: Binding(get: { settings.accountMode }, set: { newMode in
                guard settings.accountMode != newMode else { return }
                let ports = newMode == "paper" ? [4001: 4002, 7496: 7497] : [4002: 4001, 7497: 7496]
                settings.twsPort = ports[settings.twsPort] ?? settings.twsPort
                settings.accountMode = newMode
                settings.pauseEntries = true
                message = "Save the selected account mode, then check its Gateway connection."
            })) {
                Text("Paper trading · simulated money").tag("paper")
                Text("Live trading · real money").tag("live")
            }
            Text("Changing mode pauses new entries. Only the selected account is monitored. Saving settings does not activate orders.").font(.caption).foregroundStyle(.secondary)
            if settings.accountMode == "paper" {
                Text("On the execution computer, open IB Gateway and select Paper Trading before signing in with your existing IB login. Store your login in Apple Passwords and enter it directly in Gateway. PolyTheta detects a single paper account automatically.").font(.caption).foregroundStyle(.secondary)
                Text("Paper ports: IB Gateway 4002 / TWS 7497. Keep the API read-only for the first check. Simulated trades stay separate from actual-trade performance.").font(.caption).foregroundStyle(.secondary)
            }
            Picker("Execution computer", selection: $settings.executionHostId) {
                Text("Choose a registered computer").tag("")
                ForEach(hosts) { host in Text(host.label).tag(host.id) }
            }
            Picker("Entry timing", selection: $settings.entryTiming) {
                Text("Monday morning").tag("monday-morning")
                Text("Friday: final five minutes").tag("friday-close")
            }
            TextField("Monday start (HH:MM, New York)", text: $settings.mondayEntryStart)
            TextField("Monday end (HH:MM, New York)", text: $settings.mondayEntryEnd)
            LabeledContent("Screening lead time (minutes)") { TextField("Minutes", value: $settings.preparationLeadMinutes, format: .number) }
            LabeledContent("Final refresh before window (minutes)") { TextField("Minutes", value: $settings.finalizeLeadMinutes, format: .number) }
            LabeledContent("VIX-to-IV sensitivity") { TextField("Sensitivity", value: $settings.vixIvSensitivity, format: .number) }
            LabeledContent("Model annual risk-free rate (%)") { TextField("Rate", value: $settings.modelRiskFreeRatePct, format: .number) }
            Text("Friday mode prepares before the close and targets next week’s expiry. Friday holidays use the preceding session; early closes are automatic. Monday holidays use the first session. Prices adjust for actual elapsed time, underlying moves and IV; IB fills determine actual results.").font(.caption).foregroundStyle(.secondary)
            Picker("Connection", selection: $settings.connection) {
                Text("TWS / IB Gateway").tag("tws")
                Text("IB Web API").tag("web-api")
            }
            TextField("TWS / Gateway host or IP", text: $settings.twsHost)
            LabeledContent("TWS / Gateway port") { TextField("Port", value: $settings.twsPort, format: .number) }
            LabeledContent("Dedicated TWS client ID") { TextField("Client ID", value: $settings.twsClientId, format: .number) }
            TextField("IB Web API HTTPS endpoint", text: $settings.webApiUrl)
            TextField("Expected TWS restart (HH:MM)", text: $settings.twsRestartTime)
            TextField("TWS restart time zone", text: $settings.twsRestartTimezone)
            LabeledContent("Restart recovery window (minutes)") { TextField("Minutes", value: $settings.twsRestartGraceMinutes, format: .number) }
            Text("Configure the same auto-restart time inside TWS. PolyTheta reconnects afterward; IB still normally requires weekly authentication.").font(.caption).foregroundStyle(.secondary)
            PercentSlider(label: "Percentage of account traded", value: $settings.entryCapitalPct, range: ModelSizing.tradedRange, step: ModelSizing.tradedStep)
            PercentSlider(label: "Margin available", value: $settings.marginAvailablePct, range: ModelSizing.marginRange, step: ModelSizing.marginStep)
            Toggle("Sell calls", isOn: $settings.sellCalls)
            Toggle("Sell puts", isOn: $settings.sellPuts)
            Text("Side toggles decide which legs of the published model basket this account executes; a skipped leg’s share stays unallocated. Margin available scales contracts: 400% backs four dollars of strike or spot per committed dollar. IB’s margin preview must still approve every order.").font(.caption).foregroundStyle(.secondary)
            LabeledContent("Maximum loss per ticker (% of account)") { TextField("0.1–100%", value: $settings.maxAccountLossPct, format: .number).multilineTextAlignment(.trailing) }
            Text("Defaults to 20% of account equity recorded before entry. The worker monitors each ticker and closes only its PolyTheta contracts if triggered; no standing stop order at entry.").font(.caption).foregroundStyle(.secondary)
            LabeledContent("Calls (%)") { TextField("Percent", value: $settings.callAllocationPct, format: .number).multilineTextAlignment(.trailing) }
            LabeledContent("Puts (%)") { TextField("Percent", value: $settings.putAllocationPct, format: .number).multilineTextAlignment(.trailing) }
            Stepper("Maximum trades: \(settings.maxTrades)", value: $settings.maxTrades, in: 1...20)
            LabeledContent("Gross exposure / equity ceiling (×)") { TextField("Multiple", value: $settings.reserveLeverageCeiling, format: .number).multilineTextAlignment(.trailing) }
            LabeledContent("Minimum credit / model") { TextField("Ratio", value: $settings.minimumCreditRatio, format: .number).multilineTextAlignment(.trailing) }
            LabeledContent("Cancel unfilled entry after (seconds)") { TextField("Seconds", value: $settings.entryTimeoutSeconds, format: .number) }
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
                    do { settings = try await api.updateBrokerSettings(settings); error = nil; message = "Trading settings saved. Execution requires separate activation for the selected account mode on the trading Mac." }
                    catch { self.error = error.localizedDescription }
                }
            }.disabled(!loaded || saving)
            if let url = URL(string: api.baseURL + "/trading-rules") { Link("Entry, exit and GSRS rules", destination: url) }
        }.task {
            guard api.isConfigured else { return }
            do {
                let response = try await api.getBrokerSettings()
                settings = response.broker; loaded = true
                hosts = response.executionHosts ?? []
                message = response.brokerStatus?.stale == false ? response.brokerStatus?.message ?? "IB status unavailable" : "IB connection has not been verified recently."
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct ModelSettingsSection: View {
    @EnvironmentObject var api: APIClient
    @State private var settings = ModelSettings()
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?
    @State private var saved = false
    @State private var source: [PerformanceWeekSource]?
    var body: some View {
        Section {
            LabeledContent("Model equity ($)") { TextField("Equity", value: $settings.modelEquity, format: .number).multilineTextAlignment(.trailing) }
            PercentSlider(label: "Percentage of account traded", value: $settings.accountTradedPct, range: ModelSizing.tradedRange, step: ModelSizing.tradedStep)
            PercentSlider(label: "Margin available", value: $settings.marginAvailablePct, range: ModelSizing.marginRange, step: ModelSizing.marginStep)
            Toggle("Sell calls", isOn: $settings.sellCalls)
            Toggle("Sell puts", isOn: $settings.sellPuts)
            if let source, !source.isEmpty {
                let preview = ModelSizing.compute(source, model: settings)
                LabeledContent("Track record under these settings") {
                    Text(money(preview.stats.totalPnl)).foregroundStyle(preview.stats.totalPnl >= 0 ? .green : .red).font(.body.weight(.semibold))
                }
                Text("\(preview.stats.completeWeeks) settled weeks · \(preview.stats.winningWeeks) winning · avg \(money(preview.stats.avgWeeklyPnl))/week · max drawdown \(money(preview.stats.maxDrawdown)). Recalculated as the sliders move; saved on Save.").font(.caption).foregroundStyle(.secondary)
            }
            Text("The model selects and sizes its weekly basket from these settings, and the Performance tab re-sizes every historical leg from them. 400% margin backs four dollars of notional per committed dollar; 100% reproduces the original cash-backed sizing. With both sides on, the IB call/put split sets the counts. The IB account report always shows real fills.").font(.caption).foregroundStyle(.secondary)
            if let error { ErrorBanner(message: error) }
            Button(saving ? "Saving…" : saved ? "Saved — performance recalculated" : "Save model settings") {
                Task {
                    saving = true
                    defer { saving = false }
                    do { settings = try await api.updateModelSettings(settings); error = nil; saved = true }
                    catch { self.error = error.localizedDescription }
                }
            }.disabled(!loaded || saving)
        } header: {
            Text("Model sizing")
        }.task {
            guard api.isConfigured else { return }
            do { settings = try await api.getBrokerSettings().model ?? ModelSettings(); loaded = true }
            catch { self.error = error.localizedDescription }
            source = try? await api.performance().source
        }
    }
}

// A labelled percentage slider for the settings forms.
struct PercentSlider: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text(label); Spacer(); Text("\(Int(value))%").font(.body.monospacedDigit().weight(.semibold)) }
            Slider(value: $value, in: range, step: step) { Text(label) }
                minimumValueLabel: { Text("\(Int(range.lowerBound))%").font(.caption2) }
                maximumValueLabel: { Text("\(Int(range.upperBound))%").font(.caption2) }
        }
    }
}
