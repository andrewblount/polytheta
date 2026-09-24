import Foundation

// Port of src/lib/model-sizing.ts: the model track record re-sized from the
// model settings, computed on the phone as the sliders move. Keep the two in
// step — the server returns the same numbers for the saved settings.

struct PerformanceLegSource: Codable, Identifiable {
    var id: String { positionId }
    let positionId: String
    let ticker: String
    let side: String
    let strike: Double
    let entryPrice: Double
    let entryCredit: Double
    let contracts: Int
    let margin: Double
    let credit: Double
    let pnl: Double?
    let state: String?
    let settledAt: String?
}

struct PerformanceWeekSource: Codable, Identifiable {
    var id: String { slug }
    let weekOf: String
    let slug: String
    let title: String
    let gsrs: Double
    let cashNeeded: Double
    let allocationScale: Double
    let legs: [PerformanceLegSource]
}

struct ModelPerformance {
    var weeks: [WeekRow]
    var cumulative: [CumulativePoint]
    var stats: Stats
    var basis: PerformanceBasis
}

enum ModelSizing {
    static let tradedRange: ClosedRange<Double> = 0...100
    static let tradedStep = 1.0
    static let marginRange: ClosedRange<Double> = 100...1000
    static let marginStep = 25.0

    // Dollars of strike-or-spot notional the settings back.
    static func backing(_ s: ModelSettings) -> Double {
        max(0, s.modelEquity) * s.accountTradedPct / 100 * s.marginAvailablePct / 100
    }

    struct SizedLeg { let contracts: Int; let margin: Double; let credit: Double; let pnl: Double? }

    static func resize(_ leg: PerformanceLegSource, perTrade: Double) -> SizedLeg {
        let unit = max(leg.entryPrice, leg.strike) * 100
        let contracts = unit > 0 && perTrade > 0 ? Int((perTrade / unit).rounded(.down)) : 0
        let ratio = leg.contracts > 0 ? Double(contracts) / Double(leg.contracts) : 0
        return SizedLeg(contracts: contracts, margin: (leg.margin * ratio).rounded(), credit: (leg.credit * ratio).rounded(), pnl: leg.pnl.map { $0 * ratio })
    }

    static func compute(_ source: [PerformanceWeekSource], model: ModelSettings) -> ModelPerformance {
        let backing = backing(model)
        var weeks: [WeekRow] = []
        var worstOverall: (ticker: String, side: String, pnl: Double)? = nil
        for week in source {
            let legs = week.legs.filter { $0.side == "call" ? model.sellCalls : model.sellPuts }
            if legs.isEmpty { continue }
            let perTrade = backing * (week.allocationScale > 0 ? week.allocationScale : 1) / Double(legs.count)
            var pnl = 0.0, margin = 0.0, credit = 0.0
            var wins = 0, losses = 0, settled = 0
            var worst: (ticker: String, side: String, pnl: Double)? = nil
            for leg in legs {
                let sized = resize(leg, perTrade: perTrade)
                margin += sized.margin
                credit += sized.credit
                guard let legPnl = sized.pnl, leg.state != nil, leg.settledAt != nil else { continue }
                settled += 1
                pnl += legPnl
                if legPnl >= 0 { wins += 1 } else { losses += 1 }
                if worst == nil || legPnl.rounded() < worst!.pnl { worst = (leg.ticker, leg.side, legPnl.rounded()) }
            }
            let complete = settled == legs.count && settled > 0
            weeks.append(WeekRow(weekOf: week.weekOf, slug: week.slug, title: week.title, gsrs: week.gsrs, legs: legs.count, settledLegs: settled,
                                 wins: wins, losses: losses, pnl: pnl.rounded(), margin: Int(margin), credit: Int(credit),
                                 romPct: margin > 0 ? (pnl / margin * 100 * 100).rounded() / 100 : nil, complete: complete))
            if complete, let worst, worstOverall == nil || worst.pnl < worstOverall!.pnl { worstOverall = worst }
        }
        weeks.sort { $0.weekOf < $1.weekOf }

        let complete = weeks.filter(\.complete)
        var running = 0.0, peak = 0.0, maxDrawdown = 0.0
        let cumulative = complete.map { w -> CumulativePoint in
            running += w.pnl
            peak = max(peak, running)
            maxDrawdown = min(maxDrawdown, running - peak)
            return CumulativePoint(weekOf: w.weekOf, pnl: w.pnl, cumulative: running)
        }
        let winning = complete.filter { $0.pnl >= 0 }
        let losing = complete.filter { $0.pnl < 0 }
        let totalWins = complete.reduce(0) { $0 + $1.wins }
        let totalLegs = complete.reduce(0) { $0 + $1.settledLegs }
        func avg(_ list: [WeekRow]) -> Double { list.isEmpty ? 0 : (list.reduce(0) { $0 + $1.pnl } / Double(list.count)).rounded() }
        let stats = Stats(
            totalPnl: complete.reduce(0) { $0 + $1.pnl }.rounded(),
            completeWeeks: complete.count, winningWeeks: winning.count, losingWeeks: losing.count,
            avgWeeklyPnl: avg(complete), avgWinningWeek: avg(winning), avgLosingWeek: avg(losing),
            bestWeek: complete.map(\.pnl).max() ?? 0, worstWeek: complete.map(\.pnl).min() ?? 0,
            legWinRatePct: totalLegs > 0 ? (Double(totalWins) / Double(totalLegs) * 1000).rounded() / 10 : 0,
            settledLegs: totalLegs, maxDrawdown: maxDrawdown.rounded(),
            worstLeg: worstOverall.map { Stats.WorstLeg(ticker: $0.ticker, side: $0.side, pnl: $0.pnl) })
        let basis = PerformanceBasis(sizing: "model", modelEquity: model.modelEquity, accountTradedPct: model.accountTradedPct,
                                     marginAvailablePct: model.marginAvailablePct, sellCalls: model.sellCalls, sellPuts: model.sellPuts)
        return ModelPerformance(weeks: weeks, cumulative: cumulative, stats: stats, basis: basis)
    }
}
