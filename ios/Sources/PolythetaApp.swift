import SwiftUI

#if os(iOS)
import UIKit
import UserNotifications

// Push registration: trade warnings, radar hits and exits (model and IB) are
// pushed through APNs. The token is sent to the site, which keeps it with the
// other alert channels. Foreground notifications still show as banners.
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        #if DEBUG
        let sandbox = true
        #else
        let sandbox = false
        #endif
        Task { try? await APIClient.shared.registerDevice(token: token, sandbox: sandbox, label: UIDevice.current.name) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Push registration failed: \(error.localizedDescription)")
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
#endif

@main
struct PolythetaApp: App {
    @StateObject private var api = APIClient.shared
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var pushDelegate
    #elseif os(macOS)
    @NSApplicationDelegateAdaptor(MacPushDelegate.self) private var pushDelegate
    #endif

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(api)
                .preferredColorScheme(.dark)
                .tint(polythetaAccent)
                .accentColor(polythetaAccent)
                .task {
                    #if os(iOS)
                    PhoneWatchBridge.shared.start()
                    #endif
                }
        }
        #if os(macOS)
        .defaultSize(width: 1180, height: 820)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") {
                    NotificationCenter.default.post(name: .polythetaShowSettings, object: nil)
                }.keyboardShortcut(",", modifiers: .command)
            }
        }
        #endif
    }
}

struct RootView: View {
    var body: some View {
        #if os(macOS)
        DesktopRootView()
        #else
        TabView {
            ForEach(AppDestination.allCases) { destination in
                destination.content
                    .tabItem { Label(destination.title, systemImage: destination.symbol) }
            }
        }
        #endif
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

#if os(macOS)
import AppKit
func copyToClipboard(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
}
#else
import UIKit
func copyToClipboard(_ text: String) {
    UIPasteboard.general.string = text
}
#endif

func orderLine(_ p: MobilePosition, expiry: String) -> String {
    let type = p.side == "call" ? "Call" : "Put"
    return "Sell to Open \(p.contracts) \(p.ticker) \(expiry) \(String(format: "%.2f", p.strike).replacingOccurrences(of: ".00", with: "")) \(type) – Limit \(String(format: "%.2f", p.entryCredit)) – DAY"
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
