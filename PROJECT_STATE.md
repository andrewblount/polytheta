# Polytheta project state

Last updated: 2026-10-05

## Identity and current outcome

Authoritative root: `/Users/andrewblount/Local/development/polytheta`; GitHub `andrewblount/polytheta`, branch `main`. Production: `https://polytheta.com`, Netlify site `7c943fa5-689b-484d-abd0-5c506cf8843d`. Native sources are `ios/Sources` and `ios/Shared`; `ios/project.yml` generates the iOS, Mac, and Watch targets.

The current phase modernizes the Mac app and restores parity with iOS. Mac release **1.7.1 (17)** replaces the installed **1.3 (4)** at `/Applications/Polytheta.app`. The original app is preserved under `/Users/andrewblount/.local/state/polytheta/mac-ui-2026-10-05/`. The iOS/Watch marketing/build versions remain **1.7.0 (16)**; this task does not upload a new TestFlight release.

## Completed work and verification

The Mac has a sidebar, bounded content, grouped Settings panels, clearly labeled fields, separate notification rows, organized broker sections, desktop refresh actions, and keyboard shortcuts. Initial reads finish while the window settles; selecting another section clears an archived detail. A single destination catalog and the shared screens provide all seven iOS areas, including IB controls, model sizing, thesis/decisions, account performance, price paths, and post-mortems.

Apple registered and provisioned the Mac push capability. Native registration uses its signed APNs environment; server routing distinguishes Mac and iOS topics. Full tests: **172 passing**; Mac release UI: **four passing**; iOS/Watch simulator builds, typecheck, and changed-server lint succeed. Installed-app checks verified startup availability, archive charts, and the IOVA post-mortem. See [the native review](docs/native-mac-review-2026-10-05.md) for parity, evidence, and release details. Unrelated pre-existing edits remain outside this commit.

## Decisions, gaps, next action

The weekly model remains independent of IB execution. Model performance and actual account fills stay separate; activation and orders remain owner controlled. No trade, exit, or trading-settings change was submitted during review.

Live APIs returned 200; October 5 has no published basket, and September 28 has eight leg paths but no stored thesis. **Apple push delivery is unconfigured on the server**, affecting both platforms; Mac permission and credential setup remain necessary before demonstrated delivery. Next action: finish shared Apple push setup in a fresh chat, starting with this brief. Build the Mac alongside future iOS releases with `scripts/build_mac.sh`.

Prior model/reconstruction decisions and dated release/access records are retained in [the historical handoff](docs/project-state-2026-09-24.md).
