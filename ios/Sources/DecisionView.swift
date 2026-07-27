import SwiftUI

// Why this name is in the basket: the thesis-confirmation signals from the
// trading system (fan score, short interest, Glassdoor, buyback, radar) plus
// the mechanical screen checks. Zero-valued signals on auto-generated
// baskets mean "not evaluated" (except call-side buyback, where 0 is the
// desired no-active-program state).
struct PositionDecisionView: View {
    let position: MobilePosition

    var isCall: Bool { position.side == "call" }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(position.ticker).font(.title2.weight(.bold))
                        Text("\(isCall ? "CALL" : "PUT") $\(position.strike, specifier: "%.2f") · exp \(position.expiry)")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    Text(position.thesisSummary)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                }
                .padding(.vertical, 4)
            } header: {
                Text(isCall ? "Short call — weak/hyped name thesis" : "Short put — strong name thesis")
            }

            if let s = position.signals {
                Section("Thesis signals (weights per the system)") {
                    signalRow(
                        "Short interest", weight: "30%",
                        value: s.shortInterestPctFloat > 0 ? String(format: "%.1f%% of float", s.shortInterestPctFloat) : nil,
                        target: isCall ? "wants ≥ 20% (crowded short = weak name)" : "wants < 15% (clean holder base)",
                        pass: s.shortInterestPctFloat > 0
                            ? (isCall ? s.shortInterestPctFloat >= 20 : s.shortInterestPctFloat < 15) : nil)
                    signalRow(
                        "Fan score", weight: "25%",
                        value: s.fanScore > 0 ? String(format: "%.1f / 10", s.fanScore) : nil,
                        target: isCall ? "wants ≤ 7 (no cult following to squeeze)" : "wants 7–10 (buy-the-dip loyalty)",
                        pass: s.fanScore > 0
                            ? (isCall ? s.fanScore <= 7 : s.fanScore >= 7 && s.fanScore <= 10) : nil)
                    signalRow(
                        "Culture / Glassdoor", weight: "20%",
                        value: s.glassdoorScore > 0 ? String(format: "%.1f / 5", s.glassdoorScore) : nil,
                        target: isCall ? "wants ≤ 3.4 (distress inside)" : "wants > 3.5 (healthy company)",
                        pass: s.glassdoorScore > 0
                            ? (isCall ? s.glassdoorScore <= 3.4 : s.glassdoorScore > 3.5) : nil)
                    signalRow(
                        "Buyback", weight: "15%",
                        value: buybackLabel(s.buybackScore),
                        target: isCall ? "wants 0 — active buyback DISQUALIFIES a short call" : "wants +1 (structural support)",
                        pass: isCall ? (s.buybackScore == 0 ? true : s.buybackScore == -1 ? false : nil)
                                     : (s.buybackScore == 1 ? true : nil))
                    signalRow(
                        "IV / HV rank", weight: "screen",
                        value: s.ivRank > 0 ? String(format: "%.0f", s.ivRank) : nil,
                        target: "premium richness (HV-rank proxy for IV rank ≥ 80th pct)",
                        pass: nil)
                }
            }

            if let bullets = position.thesisBullets, !bullets.isEmpty {
                Section("Screen checks at selection") {
                    ForEach(bullets, id: \.self) { b in
                        Label(b, systemImage: "checkmark.circle")
                            .font(.footnote)
                            .foregroundStyle(.primary)
                    }
                }
            }

            if !position.cautionFlags.isEmpty {
                Section("Cautions") {
                    ForEach(position.cautionFlags, id: \.self) { flag in
                        Label(flag, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }
            }

            Section {
                Text("Selection order: hard disqualifiers (call-side buyback, radar hits, extreme frenzy) first, then thesis-signal rank, then \(isCall ? "richest IV" : "largest market cap"). Strikes must satisfy delta 0.15–0.20, spread ≤ $0.15\(isCall ? "" : ", and ≥ 2x ATR below spot"). Unknown signals never count as passes.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("How this pick was made")
            }
        }
        .navigationTitle("\(position.ticker) decision")
    }

    func buybackLabel(_ v: Int) -> String? {
        switch v {
        case -1: return "-1 · active program"
        case 1: return "+1 · active program"
        default: return isCall ? "0 · none found" : nil
        }
    }

    @ViewBuilder
    func signalRow(_ name: String, weight: String, value: String?, target: String, pass: Bool?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(name).font(.subheadline.weight(.medium))
                Text(weight).font(.caption2).foregroundStyle(.secondary)
                Spacer()
                if let value {
                    Text(value).font(.subheadline.weight(.semibold))
                    if let pass {
                        Image(systemName: pass ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundStyle(pass ? .green : .red)
                            .font(.subheadline)
                    }
                } else {
                    Text("not evaluated")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
            Text(target).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

// Basket-level rationale: the GSRS regime and what it did to sizing.
struct BasketDecisionView: View {
    let basket: MobileBasket

    var body: some View {
        List {
            Section("Risk regime (GSRS)") {
                VStack(alignment: .leading, spacing: 6) {
                    Text(String(format: "GSRS %.2f", basket.gsrs))
                        .font(.title2.weight(.bold))
                        .foregroundStyle(basket.gsrs < 3 ? .green : basket.gsrs < 5 ? .yellow : .red)
                    Text(basket.market.gsrsNote)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
            Section("Sizing consequence") {
                Text(basket.metrics.gsrsConstraintNote)
                    .font(.footnote)
            }
            Section("Radar status at selection") {
                Text(basket.radarStatus).font(.footnote)
                Text("Fresh acquisition news disqualifies call candidates; downside-gap news disqualifies puts. During the week, the hourly radar emails and iMessages any new signal — those are exit triggers.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Bands") {
                Text("GSRS 0–3: full sizing · 3–5: half-size puts, no put doubles · 5–7: no new puts · 7–10: no puts, hedge flagged. Policy v3: all entries held to expiry; exits only on radar signals.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Why this basket")
    }
}
