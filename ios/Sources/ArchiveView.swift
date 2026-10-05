import SwiftUI

struct ArchiveView: View {
    @EnvironmentObject var api: APIClient
    @State private var baskets: [BasketListItem] = []
    @State private var error: String?

    var body: some View {
        ScreenNavigation {
            List {
                if let error { ErrorBanner(message: error) }
                ForEach(baskets) { b in
                    NavigationLink {
                        ArchiveBasketView(slug: b.slug, weekOf: b.weekOf)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(b.weekOf).font(.subheadline.weight(.medium))
                                Text("\(b.names) names · GSRS \(b.gsrs, specifier: "%.2f")")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 3) {
                                Text(money(Double(b.totalEstimatedCredit)))
                                    .font(.subheadline.weight(.semibold))
                                Text(b.status)
                                    .font(.caption2)
                                    .foregroundStyle(b.status == "published" ? .green : .secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Archive")
            .refreshable { await load() }
            .desktopRefresh { await load() }
            .loadOnAppearance { await load() }
        }
    }

    func load() async {
        guard api.isConfigured else { return }
        do {
            baskets = try await api.baskets().baskets
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
