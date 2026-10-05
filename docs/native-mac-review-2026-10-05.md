# Native Mac review — October 5, 2026

Authoritative project: `/Users/andrewblount/Local/development/polytheta`; native sources: `ios/Sources`, `ios/Shared`; targets: `PolythetaMac`, `Polytheta`, `PolythetaWatch`.

## Findings and changes

The installed Mac app was **1.3 (4)**, while the iOS source was **1.7.0 (16)**. The installed desktop version lacked newer screens and settings. Its default Mac form laid out the connection fields across the entire window and packed notification controls together.

Mac **1.7.1 (17)** uses a persistent sidebar, a bounded content column, minimum window dimensions, and four focused Settings panels: Connection, Model, Trading, Notifications. Forms use grouped styling and labeled fields; every notification channel has its own row. Broker settings have separate sections for account selection, scheduling, connection/recovery, sizing/risk, exclusions, and per-trade minimum OTM. Desktop data screens have Refresh and Command-R; sections have Command-1 through Command-7 shortcuts; Command-comma opens Settings.

Mac launch reads complete even while SwiftUI settles the window, avoiding a false cancellation error. Section changes reset the split-view navigation coordinator so an archived detail cannot remain above another selected section. One desktop navigation stack owns detail pages; iOS retains a stack per tab.

## iOS parity

| Area | Mac implementation |
|---|---|
| IB positions, reconciliation, exit requests | Same `LiveTradesView` and APIs |
| Current basket, dated availability, decisions, thesis | Same `DashboardView`, decision and thesis views |
| Trade logging and fills | Same `TradesView` and validation; grouped desktop sheet |
| Alert history and delivery preferences | Same alert feed, categories, four channels |
| Model and account performance | Same `PerformanceView`, sizing engine, sliders, charts, settled-week links |
| Archive, price paths, post-mortems | Same archive/detail/chart views and endpoints |
| Model, broker, timing, risk settings | Same model and broker setting sections and API |
| Apple push | Mac delegate, signed entitlement, explicit permission control, platform-specific server routing |

`AppDestination` supplies the same seven screens to both platforms. The iPhone/Watch relay remains an iOS integration; desktop trading controls use the same broker service directly. `scripts/build_mac.sh` builds a signed desktop release from these shared sources and should accompany future native releases.

## Verification and limits

The Mac release is built from an isolated snapshot of the staged changes. The complete JavaScript/TypeScript suite passes **172 tests**; typecheck and changed-server lint pass. Mac UI checks cover Settings panels, distinct notification rows, all seven destinations, refresh actions, the trade sheet, startup, and leaving an archive detail. iOS and the embedded Watch simulator build succeed. Initial navigation failure and the passing fix are preserved in the private evidence folder.

Authenticated live reads returned 200 for summary, settings, performance, IB, and push-device status. Performance supplies 24 historical source weeks. The September 28 leg endpoint returned eight paths, and the installed app rendered charts and the IOVA post-mortem. That basket has no stored thesis; its explicit missing-data notice is shared with iOS. October 5 has no published basket at review time and is presented as dated availability, not a stale archive.

**Apple push delivery remains unconfigured on the server** (`configured: false`): its credentials are absent. Mac capability and provisioning are ready, but delivery has not been demonstrated. No test push, trade, exit request, or settings save was submitted during this review. No iOS TestFlight release was uploaded in this task.

Private evidence and the old app backup: `/Users/andrewblount/.local/state/polytheta/mac-ui-2026-10-05/`. Working logs: `/tmp/polytheta-mac-ui-20261005/`. Unrelated pre-existing edits remain outside the commit.

## Delivered release

Source commit `6ec797c` is pushed to main. The final signed Mac **1.7.1 (17)** is installed at `/Applications/Polytheta.app`; its archive-to-Settings transition was verified after installation, and Settings is left open. Netlify production publication completed on October 5. Post-publication authenticated summary, settings, performance, IB, device status, and September 28 leg paths all returned 200. Device status still reports `configured: false`, as recorded above. The private evidence directory contains the deployment receipt, source/install verification, final UI test result, and API check record.
