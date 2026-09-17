import Foundation
struct BrokerPortfolioResponse: Codable {
    let snapshot: BrokerPortfolioSnapshot?
    let requests: [BrokerExitRequest]
    let stale: Bool
    var isFresh: Bool {
        guard !stale, let at = snapshot?.observedAt, let date = Self.date(at) else { return false }
        return Date().timeIntervalSince(date) >= -1 && Date().timeIntervalSince(date) < 120
    }
    static func date(_ value: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
struct BrokerPortfolioSnapshot: Codable {
    let mode: String?
    let accountKey: String
    let observedAt: String
    let activated: Bool
    let positions: [BrokerPosition]
    let unrealizedPnl: Double?
    let realizedPnl: Double
    let fees: Double
    let complete: Bool
}
struct BrokerPosition: Codable, Identifiable {
    var id: Int { conid }
    let conid: Int
    let ticker: String
    let side: String
    let strike: Double
    let expiry: String
    let quantity: Int
    let averageFill: Double?
    let mark: Double?
    let unrealizedPnl: Double?
    let status: String
    let canExit: Bool
    let workingEntry: Bool
    let entryPricing: BrokerEntryPricing?
    let lossStop: BrokerLossStop?
}
struct BrokerLossStop: Codable {
    let status: String?
    let baselineEquity: Double?
    let thresholdAmount: Double?
    let lossAmount: Double?
    let lossPct: Double?
    let triggeredAt: String?
    let message: String?
}
struct BrokerEntryPricing: Codable {
    let credit: Double
    let referenceCredit: Double
    let elapsedCalendarDays: Double
    let referenceSpot: Double
    let spot: Double
    let iv: Double
    let ivSource: String
    let timeEffect: Double
    let underlyingEffect: Double
    let ivEffect: Double
    let observedAt: String
    let estimatedAt: String
}
struct BrokerExitRequest: Codable, Identifiable {
    var id: String { requestId }
    let requestId: String
    let requestedAt: String
    let status: String
    let message: String
}
struct BrokerExitInput: Codable {
    let requestId: String
    let accountKey: String
    let scope: String
    let conid: Int?
}
func brokerMoney(_ value: Double?) -> String {
    guard let value else { return "Unavailable" }
    return value.formatted(.currency(code: "USD"))
}
