import SwiftUI

struct TradesView: View {
    @EnvironmentObject var api: APIClient
    @State private var trades: [Trade] = []
    @State private var error: String?
    @State private var showingForm = false

    var netCash: Double { trades.reduce(0) { $0 + $1.cashFlow } }
    var openContracts: Int {
        trades.reduce(0) { $0 + ($1.action == "sell-to-open" ? $1.quantity : -$1.quantity) }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) }

                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Net premium").font(.caption2).foregroundStyle(.secondary)
                            Text(money(netCash))
                                .font(.title3.weight(.bold))
                                .foregroundStyle(netCash >= 0 ? .green : .red)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("Open contracts").font(.caption2).foregroundStyle(.secondary)
                            Text("\(openContracts)").font(.title3.weight(.bold))
                        }
                    }
                    .padding(.vertical, 2)
                } footer: {
                    Text("Your executed fills, after fees. Recommendations live on the Basket tab — this is what you actually traded.")
                }

                Section("Fills") {
                    if trades.isEmpty {
                        Text("No trades logged yet. Tap + to record your first fill.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(trades) { t in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(t.action == "sell-to-open" ? "STO" : "BTC")
                                    .font(.caption2.weight(.bold))
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(
                                        (t.action == "sell-to-open" ? Color.green : Color.orange).opacity(0.18),
                                        in: RoundedRectangle(cornerRadius: 5))
                                    .foregroundStyle(t.action == "sell-to-open" ? .green : .orange)
                                Text("\(t.ticker) \(t.side == "call" ? "C" : "P") $\(t.strike, specifier: "%.2f")")
                                    .font(.subheadline.weight(.semibold))
                                Spacer()
                                Text(money(t.cashFlow))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(t.cashFlow >= 0 ? .green : .red)
                            }
                            Text("\(t.quantity)x @ \(t.price, specifier: "%.2f") · exp \(t.expiry) · \(t.broker ?? "—") · \(String(t.executedAt.prefix(10)))")
                                .font(.caption2).foregroundStyle(.secondary)
                            if let notes = t.notes, !notes.isEmpty {
                                Text(notes).font(.caption2).foregroundStyle(.secondary).italic()
                            }
                        }
                        .swipeActions {
                            Button(role: .destructive) {
                                Task { await remove(t) }
                            } label: { Label("Delete", systemImage: "trash") }
                        }
                    }
                }
            }
            .navigationTitle("Trades")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingForm = true } label: { Label("Log trade", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $showingForm) {
                TradeFormView { newTrade in
                    Task {
                        do {
                            let created = try await api.createTrade(newTrade)
                            trades.insert(created, at: 0)
                            error = nil
                        } catch { self.error = error.localizedDescription }
                    }
                }
                .environmentObject(api)
                #if os(macOS)
                .frame(minWidth: 420, minHeight: 560)
                #endif
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    func load() async {
        guard api.isConfigured else { return }
        do {
            trades = try await api.trades().trades
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func remove(_ t: Trade) async {
        do {
            try await api.deleteTrade(id: t.id)
            trades.removeAll { $0.id == t.id }
        } catch { self.error = error.localizedDescription }
    }
}

struct TradeFormView: View {
    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    let onSave: (NewTrade) -> Void

    @State private var action = "sell-to-open"
    @State private var ticker = ""
    @State private var side = "call"
    @State private var strike = ""
    @State private var expiry = Date()
    @State private var quantity = ""
    @State private var price = ""
    @State private var fees = "0"
    @State private var broker = "IBKR"
    @State private var executedAt = Date()
    @State private var notes = ""
    @State private var positionId: String?
    @State private var basketPositions: [MobilePosition] = []
    @State private var validationError: String?

    var body: some View {
        NavigationStack {
            Form {
                if !basketPositions.isEmpty {
                    Section("Prefill from current basket") {
                        Menu("Choose a position…") {
                            ForEach(basketPositions) { p in
                                Button("\(p.ticker) \(p.side == "call" ? "C" : "P") $\(String(format: "%.2f", p.strike)) — \(p.contracts)x @ \(String(format: "%.2f", p.entryCredit))") {
                                    ticker = p.ticker
                                    side = p.side
                                    strike = String(format: "%.2f", p.strike)
                                    quantity = String(p.contracts)
                                    price = String(format: "%.2f", p.entryCredit)
                                    positionId = p.id
                                    if let d = ISO8601DateFormatter().date(from: p.expiry + "T12:00:00Z") { expiry = d }
                                    else {
                                        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
                                        if let d = f.date(from: p.expiry) { expiry = d }
                                    }
                                }
                            }
                        }
                    }
                }
                Section("Order") {
                    Picker("Action", selection: $action) {
                        Text("Sell to open").tag("sell-to-open")
                        Text("Buy to close").tag("buy-to-close")
                    }.pickerStyle(.segmented)
                    TextField("Ticker", text: $ticker)
                        #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        #endif
                    Picker("Side", selection: $side) {
                        Text("Call").tag("call"); Text("Put").tag("put")
                    }.pickerStyle(.segmented)
                    TextField("Strike", text: $strike)
                    DatePicker("Expiry", selection: $expiry, displayedComponents: .date)
                    TextField("Contracts", text: $quantity)
                    TextField("Price per contract", text: $price)
                    TextField("Fees (total)", text: $fees)
                }
                Section("Details") {
                    Picker("Broker", selection: $broker) {
                        Text("IBKR").tag("IBKR"); Text("Schwab").tag("Schwab"); Text("Other").tag("Other")
                    }
                    DatePicker("Executed", selection: $executedAt)
                    TextField("Notes", text: $notes)
                }
                if let validationError {
                    Text(validationError).font(.footnote).foregroundStyle(.red)
                }
                Section {
                    Button("Save trade") { save() }
                        .buttonStyle(.borderedProminent)
                    Button("Cancel", role: .cancel) { dismiss() }
                }
            }
            .navigationTitle("Log Trade")
            .task {
                if let b = try? await api.summary().basket {
                    basketPositions = b.allPositions
                }
            }
        }
    }

    func save() {
        guard !ticker.trimmingCharacters(in: .whitespaces).isEmpty,
              let k = Double(strike), k > 0,
              let q = Int(quantity), q > 0,
              let pr = Double(price), pr >= 0,
              let fe = Double(fees), fe >= 0 else {
            validationError = "Check ticker, strike, contracts, price, and fees."
            return
        }
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.timeZone = TimeZone(identifier: "UTC")
        onSave(NewTrade(
            ticker: ticker.uppercased(),
            side: side,
            action: action,
            strike: k,
            expiry: df.string(from: expiry),
            quantity: q,
            price: pr,
            fees: fe,
            broker: broker,
            executedAt: ISO8601DateFormatter().string(from: executedAt),
            notes: notes.isEmpty ? nil : notes,
            positionId: positionId
        ))
        dismiss()
    }
}
