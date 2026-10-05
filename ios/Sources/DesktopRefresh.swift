import SwiftUI

extension View {
    @ViewBuilder func loadOnAppearance(_ action: @escaping () async -> Void) -> some View {
        #if os(macOS)
        // macOS can replace the initial navigation content while its window
        // settles. Let the read finish instead of cancelling it with that task.
        onAppear { Task { await action() } }
        #else
        task { await action() }
        #endif
    }

    @ViewBuilder func desktopRefresh(_ action: @escaping () async -> Void) -> some View {
        #if os(macOS)
        modifier(DesktopRefreshModifier(action: action))
        #else
        self
        #endif
    }
}

#if os(macOS)
private struct DesktopRefreshModifier: ViewModifier {
    let action: () async -> Void
    @State private var refreshing = false

    func body(content: Content) -> some View {
        content.toolbar {
            Button {
                Task {
                    refreshing = true
                    defer { refreshing = false }
                    await action()
                }
            } label: { Label("Refresh", systemImage: "arrow.clockwise") }
            .disabled(refreshing)
            .keyboardShortcut("r", modifiers: .command)
            .help("Refresh data (⌘R)")
        }
    }
}
#endif
