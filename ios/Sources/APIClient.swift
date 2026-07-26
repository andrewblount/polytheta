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
        didSet { UserDefaults.standard.set(token, forKey: "apiToken") }
    }

    private init() {
        baseURL = UserDefaults.standard.string(forKey: "baseURL") ?? "https://polytheta.com"
        token = UserDefaults.standard.string(forKey: "apiToken") ?? ""
    }

    var isConfigured: Bool { !token.isEmpty }

    private func get<T: Codable>(_ path: String, as type: T.Type) async throws -> T {
        guard isConfigured, let url = URL(string: baseURL + path) else {
            throw APIError.notConfigured
        }
        var request = URLRequest(url: url)
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
}
