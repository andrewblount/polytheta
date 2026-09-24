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
    let expiryPrice: Double?
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

    struct LegResult { let ticker: String; let side: String; let strike: Double; let entryPrice: Double; let expiryPrice: Double?; let pnl: Double; let credit: Double; let margin: Double; let cushionPct: Double }

    static func compute(_ source: [PerformanceWeekSource], model: ModelSettings) -> ModelPerformance {
        let backing = backing(model)
        var weeks: [WeekRow] = []
        var legsByWeek: [String: [LegResult]] = [:]
        for week in source {
            let legs = week.legs.filter { $0.side == "call" ? model.sellCalls : model.sellPuts }
            if legs.isEmpty { continue }
            let perTrade = backing * (week.allocationScale > 0 ? week.allocationScale : 1) / Double(legs.count)
            var pnl = 0.0, margin = 0.0, credit = 0.0
            var wins = 0, losses = 0, settled = 0
            var results: [LegResult] = []
            for leg in legs {
                let sized = resize(leg, perTrade: perTrade)
                margin += sized.margin
                credit += sized.credit
                guard let legPnl = sized.pnl, leg.state != nil, leg.settledAt != nil else { continue }
                settled += 1
                pnl += legPnl
                if legPnl >= 0 { wins += 1 } else { losses += 1 }
                let cushion = leg.side == "call" ? leg.strike - leg.entryPrice : leg.entryPrice - leg.strike
                results.append(LegResult(ticker: leg.ticker, side: leg.side, strike: leg.strike, entryPrice: leg.entryPrice, expiryPrice: leg.expiryPrice,
                                         pnl: legPnl.rounded(), credit: leg.entryCredit * 100 * Double(sized.contracts), margin: sized.margin,
                                         cushionPct: leg.entryPrice > 0 ? cushion / leg.entryPrice * 100 : 0))
            }
            let complete = settled == legs.count && settled > 0
            let worst = results.min { $0.pnl < $1.pnl }
            weeks.append(WeekRow(weekOf: week.weekOf, slug: week.slug, title: week.title, gsrs: week.gsrs, legs: legs.count, settledLegs: settled,
                                 wins: wins, losses: losses, pnl: pnl.rounded(), margin: Int(margin), credit: Int(credit),
                                 romPct: margin > 0 ? (pnl / margin * 100 * 100).rounded() / 100 : nil, complete: complete,
                                 worstLeg: worst.map { Stats.WorstLeg(ticker: $0.ticker, side: $0.side, pnl: $0.pnl, strike: $0.strike, entryPrice: $0.entryPrice, expiryPrice: $0.expiryPrice) }))
            if complete { legsByWeek[week.slug] = results }
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
        func sum(_ list: [WeekRow]) -> Double { list.reduce(0) { $0 + $1.pnl } }
        func avg(_ list: [WeekRow]) -> Double { list.isEmpty ? 0 : (sum(list) / Double(list.count)).rounded() }
        func mean(_ list: [Double]) -> Double? { list.isEmpty ? nil : list.reduce(0, +) / Double(list.count) }
        let allLegs = complete.flatMap { legsByWeek[$0.slug] ?? [] }
        let grossWins = sum(winning), grossLosses = -sum(losing)
        let legCredit = allLegs.reduce(0) { $0 + $1.credit }, legMargin = allLegs.reduce(0) { $0 + $1.margin }, legPnl = allLegs.reduce(0) { $0 + $1.pnl }
        let weeklyMean = mean(complete.map(\.pnl)) ?? 0
        let weeklySd = complete.count >= 3 ? (complete.reduce(0) { $0 + ($1.pnl - weeklyMean) * ($1.pnl - weeklyMean) } / Double(complete.count - 1)).squareRoot() : 0
        var longestLosing = 0, run = 0
        for w in complete { run = w.pnl < 0 ? run + 1 : 0; longestLosing = max(longestLosing, run) }
        var currentStreak = 0
        for w in complete.reversed() {
            let sign = w.pnl >= 0 ? 1 : -1
            if currentStreak == 0 { currentStreak = sign } else if (currentStreak > 0) == (sign > 0) { currentStreak += sign } else { break }
        }
        func side(_ s: String) -> SidePerformance {
            let legs = allLegs.filter { $0.side == s }
            let wins = legs.filter { $0.pnl >= 0 }.count
            return SidePerformance(legs: legs.count, wins: wins, pnl: legs.reduce(0) { $0 + $1.pnl }.rounded(), credit: legs.reduce(0) { $0 + $1.credit }.rounded(),
                                   winRatePct: legs.isEmpty ? 0 : (Double(wins) / Double(legs.count) * 1000).rounded() / 10)
        }
        func r1(_ v: Double?) -> Double? { v.map { ($0 * 10).rounded() / 10 } }
        let worstOverall = allLegs.min { $0.pnl < $1.pnl }
        let stats = Stats(
            totalPnl: sum(complete).rounded(),
            completeWeeks: complete.count, winningWeeks: winning.count, losingWeeks: losing.count,
            avgWeeklyPnl: avg(complete), avgWinningWeek: avg(winning), avgLosingWeek: avg(losing),
            bestWeek: complete.map(\.pnl).max() ?? 0, worstWeek: complete.map(\.pnl).min() ?? 0,
            legWinRatePct: totalLegs > 0 ? (Double(totalWins) / Double(totalLegs) * 1000).rounded() / 10 : 0,
            settledLegs: totalLegs, maxDrawdown: maxDrawdown.rounded(),
            worstLeg: worstOverall.map { Stats.WorstLeg(ticker: $0.ticker, side: $0.side, pnl: $0.pnl, strike: $0.strike, entryPrice: $0.entryPrice, expiryPrice: $0.expiryPrice) },
            profitFactor: grossLosses > 0 ? (grossWins / grossLosses * 100).rounded() / 100 : nil,
            expectancyPerLeg: allLegs.isEmpty ? 0 : (legPnl / Double(allLegs.count)).rounded(),
            creditCapturePct: legCredit > 0 ? (legPnl / legCredit * 1000).rounded() / 10 : nil,
            returnOnMarginPct: legMargin > 0 ? (legPnl / legMargin * 10000).rounded() / 100 : nil,
            sharpe: weeklySd > 0 ? (weeklyMean / weeklySd * 52.0.squareRoot() * 100).rounded() / 100 : nil,
            longestLosingStreak: longestLosing, currentStreak: currentStreak,
            avgCushionPct: r1(mean(allLegs.map(\.cushionPct))),
            avgCushionWinnersPct: r1(mean(allLegs.filter { $0.pnl >= 0 }.map(\.cushionPct))),
            avgCushionLosersPct: r1(mean(allLegs.filter { $0.pnl < 0 }.map(\.cushionPct))),
            calls: side("call"), puts: side("put"))
        let basis = PerformanceBasis(sizing: "model", modelEquity: model.modelEquity, accountTradedPct: model.accountTradedPct,
                                     marginAvailablePct: model.marginAvailablePct, sellCalls: model.sellCalls, sellPuts: model.sellPuts)
        return ModelPerformance(weeks: weeks, cumulative: cumulative, stats: stats, basis: basis)
    }
}
