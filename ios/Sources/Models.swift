import Foundation

// Mirrors /api/mobile/* payloads (src/app/api/mobile/ in the repo).

struct SummaryResponse: Codable {
    let basket: MobileBasket?
}

struct MobileBasket: Codable {
    let slug: String
    let title: String
    let weekOf: String
    let status: String
    let gsrs: Double
    let radarStatus: String
    let lastRefreshAt: String?
    let market: MarketBlock
    let metrics: MetricsBlock
    let calls: [MobilePosition]
    let puts: [MobilePosition]

    var allPositions: [MobilePosition] { calls + puts }
}

struct MarketBlock: Codable {
    let vix: Double
    let skew: Double
    let hyOas: Double
    let move: Double
    let putCallRatio: Double
    let gsrsNote: String
}

struct MetricsBlock: Codable {
    let totalMargin: Int
    let cashNeeded: Int
    let totalEstimatedCredit: Int
    let dailyTheta: Int
    let gsrsConstraintNote: String
}

struct MobilePosition: Codable, Identifiable {
    let id: String
    let ticker: String
    let side: String
    let strike: Double
    let expiry: String
    let entryPrice: Double
    let entryCredit: Double
    let contracts: Int
    let margin: Int
    let delta: Double
    let buffer: String?
    let shortInterestPctFloat: Double
    let thesisSummary: String
    let thesisBullets: [String]?
    let cautionFlags: [String]
    let latest: LatestSnapshot?
    let stopBreach: Bool? // -25% of allocation crossed (heads-up, policy is hold to expiry)
    let signals: SignalScores?
}

struct SignalScores: Codable {
    let ivRank: Double
    let shortInterestPctFloat: Double
    let fanScore: Double
    let glassdoorScore: Double
    let buybackScore: Int
}

struct LatestSnapshot: Codable {
    let observedAt: String
    let state: String
    let underlyingPrice: Double
    let pnlAmount: Double
    let creditCapturePct: Double
    let daysToExpiry: Int
    let distanceToStrike: Double
}

struct PerformanceResponse: Codable {
    let weeks: [WeekRow]
    let cumulative: [CumulativePoint]
    let stats: Stats?
}

struct WeekRow: Codable, Identifiable {
    var id: String { slug }
    let weekOf: String
    let slug: String
    let title: String
    let gsrs: Double
    let legs: Int
    let settledLegs: Int
    let wins: Int
    let losses: Int
    let pnl: Double
    let margin: Int
    let credit: Int
    let romPct: Double?
    let complete: Bool
}

struct CumulativePoint: Codable, Identifiable {
    var id: String { weekOf }
    let weekOf: String
    let pnl: Double
    let cumulative: Double
}

struct Stats: Codable {
    let totalPnl: Double
    let completeWeeks: Int
    let winningWeeks: Int
    let losingWeeks: Int
    let avgWeeklyPnl: Double
    let avgWinningWeek: Double
    let avgLosingWeek: Double
    let bestWeek: Double
    let worstWeek: Double
    let legWinRatePct: Double
    let settledLegs: Int
    let maxDrawdown: Double
}

struct BasketsResponse: Codable {
    let baskets: [BasketListItem]
}

struct AlertsResponse: Codable {
    let alerts: [AlertItem]
}

struct AlertItem: Codable, Identifiable {
    let id: String
    let at: String
    let message: String
    let meta: AlertMeta?
}

struct AlertMeta: Codable {
    let kind: String?
    let ticker: String?
}

struct TradesResponse: Codable {
    let trades: [Trade]
}

struct TradeResponse: Codable {
    let trade: Trade
}

struct Trade: Codable, Identifiable {
    let id: String
    let positionId: String?
    let ticker: String
    let side: String
    let action: String // sell-to-open | buy-to-close
    let strike: Double
    let expiry: String
    let quantity: Int
    let price: Double
    let fees: Double
    let broker: String?
    let executedAt: String
    let notes: String?

    // Signed cash flow: credit received positive, debit paid negative.
    var cashFlow: Double {
        let gross = price * 100 * Double(quantity)
        return (action == "sell-to-open" ? gross : -gross) - fees
    }
}

struct NewTrade: Codable {
    var ticker: String
    var side: String
    var action: String
    var strike: Double
    var expiry: String
    var quantity: Int
    var price: Double
    var fees: Double
    var broker: String?
    var executedAt: String
    var notes: String?
    var positionId: String?
}

struct BasketListItem: Codable, Identifiable {
    var id: String { slug }
    let slug: String
    let title: String
    let weekOf: String
    let status: String
    let gsrs: Double
    let totalMargin: Int
    let totalEstimatedCredit: Int
    let names: Int
}
