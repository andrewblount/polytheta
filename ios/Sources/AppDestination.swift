import SwiftUI

let polythetaAccent = Color(red: 0.53, green: 0.71, blue: 1.0)

// One destination catalog for both platforms prevents desktop features drifting
// behind the phone. Only the navigation presentation differs.
enum AppDestination: String, CaseIterable, Identifiable {
    case live, basket, trades, alerts, performance, archive, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .live: return "Live IB"
        case .basket: return "Basket"
        case .trades: return "Trades"
        case .alerts: return "Alerts"
        case .performance: return "Performance"
        case .archive: return "Archive"
        case .settings: return "Settings"
        }
    }
    var symbol: String {
        switch self {
        case .live: return "chart.line.uptrend.xyaxis"
        case .basket: return "basket"
        case .trades: return "list.bullet.rectangle.portrait"
        case .alerts: return "bell.badge"
        case .performance: return "chart.bar.xaxis"
        case .archive: return "archivebox"
        case .settings: return "gearshape"
        }
    }
    @ViewBuilder var content: some View {
        switch self {
        case .live: LiveTradesView()
        case .basket: DashboardView()
        case .trades: TradesView()
        case .alerts: AlertsView()
        case .performance: PerformanceView()
        case .archive: ArchiveView()
        case .settings: SettingsView()
        }
    }
}

// The desktop owns one stack around its selected screen. The phone keeps a
// separate stack per tab; nesting those stacks inside a split view traps details.
struct ScreenNavigation<Content: View>: View {
    private let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        #if os(macOS)
        content
        #else
        NavigationStack { content }
        #endif
    }
}

#if os(macOS)
extension Notification.Name {
    static let polythetaShowSettings = Notification.Name("polytheta.showSettings")
    static let polythetaShowAlerts = Notification.Name("polytheta.showAlerts")
}

struct DesktopRootView: View {
    @EnvironmentObject private var api: APIClient
    @SceneStorage("desktop.destination") private var destinationID = AppDestination.basket.rawValue
    @State private var visibility = NavigationSplitViewVisibility.all
    private var destination: AppDestination { AppDestination(rawValue: destinationID) ?? .basket }

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "chart.xyaxis.line")
                        .font(.title2).foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("POLYTHETA").font(.headline).tracking(1.5)
                        Text("Trading workspace").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }.padding(20)
                List {
                    Section("Trading") {
                        destinationRow(.live)
                        destinationRow(.basket)
                        destinationRow(.trades)
                        destinationRow(.alerts)
                    }
                    Section("Research") {
                        destinationRow(.performance)
                        destinationRow(.archive)
                    }
                    Section { destinationRow(.settings) }
                }.listStyle(.sidebar)
                Divider()
                Label(api.isConfigured ? "API token saved" : "Connection needed",
                      systemImage: api.isConfigured ? "key.fill" : "exclamationmark.circle")
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(18)
            }
            .navigationSplitViewColumnWidth(min: 210, ideal: 230, max: 270)
        } detail: {
            NavigationStack {
                destination.content
                    .listStyle(.inset)
                    .frame(maxWidth: destination == .settings ? 860 : 1120)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .background(Color(nsColor: .windowBackgroundColor))
            }.id(destination)
        }
        // macOS also retains view-based destinations in the split coordinator.
        // Reset it with the selected section, while preserving sidebar visibility.
        .id(destination)
        .navigationSplitViewStyle(.balanced)
        .frame(minWidth: 900, minHeight: 640)
        .onReceive(NotificationCenter.default.publisher(for: .polythetaShowSettings)) { _ in
            destinationID = AppDestination.settings.rawValue
        }
        .onReceive(NotificationCenter.default.publisher(for: .polythetaShowAlerts)) { _ in
            destinationID = AppDestination.alerts.rawValue
        }
    }

    private func destinationRow(_ item: AppDestination) -> some View {
        Button { destinationID = item.rawValue } label: {
            Label(item.title, systemImage: item.symbol)
                .font(.body.weight(destination == item ? .semibold : .regular))
                .foregroundStyle(destination == item ? polythetaAccent : .primary)
                .padding(.horizontal, 10).padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(destination == item ? polythetaAccent.opacity(0.16) : .clear,
                            in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("destination.\(item.rawValue)")
        .accessibilityAddTraits(destination == item ? [.isSelected] : [])
        .keyboardShortcut(KeyEquivalent(Character(String(AppDestination.allCases.firstIndex(of: item)! + 1))), modifiers: .command)
        .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
    }
}
#endif
