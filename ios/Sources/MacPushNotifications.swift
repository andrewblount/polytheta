#if os(macOS)
import AppKit
import Security
import SwiftUI
import UserNotifications

@MainActor
final class MacPushNotifications: ObservableObject {
    static let shared = MacPushNotifications()
    @Published private(set) var status = "Enable notifications to receive trade warnings and exits on this Mac."
    @Published private(set) var busy = false
    private var deviceToken: String?

    func refresh() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional:
            status = "Notifications allowed. Registering this Mac…"
            NSApplication.shared.registerForRemoteNotifications()
            await registerDevice()
        case .denied:
            status = "Notifications are off. Allow Polytheta in System Settings → Notifications."
        default:
            break
        }
    }

    func enable() async {
        busy = true
        defer { busy = false }
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            guard allowed else { status = "Notifications were not allowed. You can enable them in System Settings."; return }
            await refresh()
        } catch { status = "Notification setup failed: \(error.localizedDescription)" }
    }

    func received(_ token: Data) async {
        deviceToken = token.map { String(format: "%02x", $0) }.joined()
        await registerDevice()
    }

    func failed(_ error: Error) {
        status = "Mac push registration failed: \(error.localizedDescription)"
    }

    private func registerDevice() async {
        guard let deviceToken else { return }
        guard APIClient.shared.isConfigured else { status = "Notifications allowed. Add your API token in Connection to finish setup."; return }
        // Use the signed entitlement, since a local Release build still has a
        // development profile. DEBUG alone cannot identify the APNs environment.
        guard let task = SecTaskCreateFromSelf(nil),
              let environment = SecTaskCopyValueForEntitlement(task, "com.apple.developer.aps-environment" as CFString, nil) as? String else {
            status = "This build is missing its Apple push entitlement."
            return
        }
        do {
            let configured = try await APIClient.shared.registerDevice(token: deviceToken, sandbox: environment == "development", label: "Polytheta Mac", platform: "macos")
            status = configured ? "This Mac is registered for trade warnings and exits." : "This Mac is registered. Apple push delivery still needs to be configured for your account."
        } catch { status = "Mac push setup failed: \(error.localizedDescription)" }
    }
}

final class MacPushDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        Task { await MacPushNotifications.shared.refresh() }
    }

    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await MacPushNotifications.shared.received(deviceToken) }
    }

    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { MacPushNotifications.shared.failed(error) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await MainActor.run {
            NotificationCenter.default.post(name: .polythetaShowAlerts, object: nil)
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
    }
}
#endif
