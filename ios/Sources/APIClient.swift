import Foundation

enum APIError: LocalizedError {
    case notConfigured
    case unauthorized
    case badStatus(Int)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Set your API token in Settings."
        case .unauthorized: return "Token rejected — check Settings."
        case .badStatus(let code): return "Server returned \(code)."
        }
    }
}

@MainActor
final class APIClient: ObservableObject {
    static let shared = APIClient()

    @Published var baseURL: String {
        didSet { UserDefaults.standard.set(baseURL, forKey: "baseURL") }
    }
    @Published var token: String {
        didSet { if TokenStore.save(token) { UserDefaults.standard.removeObject(forKey: "apiToken") } }
    }

    private init() {
        baseURL = UserDefaults.standard.string(forKey: "baseURL") ?? "https://polytheta.com"
        token = TokenStore.load() ?? UserDefaults.standard.string(forKey: "apiToken") ?? ""
        if !token.isEmpty && TokenStore.save(token) { UserDefaults.standard.removeObject(forKey: "apiToken") }
    }

    var isConfigured: Bool { !token.isEmpty }

    private func get<T: Codable>(_ path: String, as type: T.Type) async throws -> T {
        guard isConfigured, let url = URL(string: baseURL + path) else {
            throw APIError.notConfigured
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badStatus(0) }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.badStatus(http.statusCode) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func summary() async throws -> SummaryResponse {
        try await get("/api/mobile/summary", as: SummaryResponse.self)
    }

    func performance() async throws -> PerformanceResponse {
        try await get("/api/mobile/performance", as: PerformanceResponse.self)
    }

    func baskets() async throws -> BasketsResponse {
        try await get("/api/mobile/baskets", as: BasketsResponse.self)
    }

    func basket(slug: String) async throws -> MobileBasket? {
        try await get("/api/mobile/baskets/\(slug)", as: SummaryResponse.self).basket
    }

    func basketWithTrades(slug: String) async throws -> SummaryResponse {
        try await get("/api/mobile/baskets/\(slug)", as: SummaryResponse.self)
    }

    // Price path + analysis for every leg of a basket (charts and post-mortems).
    func basketLegs(slug: String) async throws -> LegPathsResponse {
        try await get("/api/mobile/baskets/\(slug)/legs", as: LegPathsResponse.self)
    }

    func alerts(hoursBack: Int = 72) async throws -> AlertsResponse {
        let since = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-Double(hoursBack) * 3600))
        return try await get("/api/mobile/alerts?since=\(since)", as: AlertsResponse.self)
    }

    func trades() async throws -> TradesResponse {
        try await get("/api/mobile/trades", as: TradesResponse.self)
    }

    func createTrade(_ trade: NewTrade) async throws -> Trade {
        guard isConfigured, let url = URL(string: baseURL + "/api/mobile/trades") else {
            throw APIError.notConfigured
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(trade)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badStatus(0) }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.badStatus(http.statusCode) }
        return try JSONDecoder().decode(TradeResponse.self, from: data).trade
    }

    func getBrokerSettings() async throws -> BrokerSettingsResponse {
        try await get("/api/mobile/settings", as: BrokerSettingsResponse.self)
    }

    func brokerPortfolio() async throws -> BrokerPortfolioResponse { try await get("/api/mobile/ib", as: BrokerPortfolioResponse.self) }
    func requestBrokerExit(_ input: BrokerExitInput) async throws -> BrokerExitRequest {
        guard isConfigured, let url = URL(string: baseURL + "/api/mobile/ib"), url.scheme == "https" else { throw APIError.notConfigured }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(input)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let result = try? JSONSerialization.jsonObject(with: data) as? [String: String]
            throw NSError(domain: "Polytheta", code: 400, userInfo: [NSLocalizedDescriptionKey: result?["error"] ?? "Exit request could not be confirmed. Refresh before trying again."])
        }
        struct Result: Decodable { let request: BrokerExitRequest }
        return try JSONDecoder().decode(Result.self, from: data).request
    }

    func updateBrokerSettings(_ settings: BrokerSettings) async throws -> BrokerSettings {
        guard isConfigured, let url = URL(string: baseURL + "/api/mobile/settings") else { throw APIError.notConfigured }
        struct Payload: Encodable { let broker: BrokerSettings }
        struct Result: Decodable { let broker: BrokerSettings }
        struct Failure: Decodable { let error: String }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Payload(broker: settings))
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(Failure.self, from: data).error) ?? "Settings could not be saved."
            throw NSError(domain: "Polytheta", code: 400, userInfo: [NSLocalizedDescriptionKey: message])
        }
        return try JSONDecoder().decode(Result.self, from: data).broker
    }

    func updateModelSettings(_ settings: ModelSettings) async throws -> ModelSettings {
        guard isConfigured, let url = URL(string: baseURL + "/api/mobile/settings") else { throw APIError.notConfigured }
        struct Payload: Encodable { let model: ModelSettings }
        struct Result: Decodable { let model: ModelSettings }
        struct Failure: Decodable { let error: String }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Payload(model: settings))
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(Failure.self, from: data).error) ?? "Model settings could not be saved."
            throw NSError(domain: "Polytheta", code: 400, userInfo: [NSLocalizedDescriptionKey: message])
        }
        return try JSONDecoder().decode(Result.self, from: data).model
    }

    // Register this phone's APNs token so trade warnings and exits push here.
    func registerDevice(token: String, sandbox: Bool, label: String) async throws {
        guard isConfigured, let url = URL(string: baseURL + "/api/mobile/devices") else { throw APIError.notConfigured }
        struct Payload: Encodable { let token: String; let platform: String; let sandbox: Bool; let label: String }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(self.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Payload(token: token, platform: "ios", sandbox: sandbox, label: label))
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw APIError.badStatus((response as? HTTPURLResponse)?.statusCode ?? 0) }
    }

    func getSettings() async throws -> [String: [String: Bool]] {
        struct SettingsResponse: Codable { let notifications: [String: [String: Bool]] }
        return try await get("/api/mobile/settings", as: SettingsResponse.self).notifications
    }

    func updateSetting(category: String, channel: String, value: Bool) async throws -> [String: [String: Bool]] {
        struct SettingsResponse: Codable { let notifications: [String: [String: Bool]] }
        guard isConfigured, let url = URL(string: baseURL + "/api/mobile/settings") else {
            throw APIError.notConfigured
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["notifications": [category: [channel: value]]])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try JSONDecoder().decode(SettingsResponse.self, from: data).notifications
    }

    func deleteTrade(id: String) async throws {
        guard isConfigured, let url = URL(string: baseURL + "/api/mobile/trades/\(id)") else {
            throw APIError.notConfigured
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }
}
