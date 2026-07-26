import SwiftUI

@main
struct PolythetaApp: App {
    @StateObject private var api = APIClient.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(api)
                .preferredColorScheme(.dark)
                .tint(Color(red: 0.53, green: 0.71, blue: 1.0)) // #88b4ff
        }
    }
}

struct RootView: View {
    @EnvironmentObject var api: APIClient

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Basket", systemImage: "basket") }
            PerformanceView()
                .tabItem { Label("Performance", systemImage: "chart.bar.xaxis") }
            ArchiveView()
                .tabItem { Label("Archive", systemImage: "archivebox") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

// Shared bits ----------------------------------------------------------------

func money(_ v: Double) -> String {
    let sign = v < 0 ? "-" : ""
    let n = abs(v)
    if n >= 1000 {
        return "\(sign)$\(Int(n).formatted(.number.grouping(.automatic)))"
    }
    return "\(sign)$\(String(format: "%.0f", n))"
}

struct StateBadge: View {
    let state: String

    var color: Color {
        switch state {
        case "safe", "expired-otm": return .green
        case "approaching-strike": return .yellow
        case "breached", "expired-itm": return .red
        default: return .gray
        }
    }

    var body: some View {
        Text(state.replacingOccurrences(of: "-", with: " "))
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
}

struct ErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.red.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
    }
}
