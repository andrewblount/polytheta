# Polytheta project state

Last updated: 2026-09-17

## Identity and objective

Authoritative root: `/Users/andrewblount/Library/CloudStorage/Dropbox/development/polytheta`; GitHub `andrewblount/polytheta`, branch `main`; production `https://polytheta.com`, Netlify site `7c943fa5-689b-484d-abd0-5c506cf8843d`. Next.js website, local Node IB worker, and native iOS/macOS/Watch sources under `ios/`. Add a visible paper-account connection before live trading.

## Decisions and implementation

Settings now persists `accountMode` (paper/live), with matching web and native controls. Existing settings retain live mode until explicitly switched. Mode changes pause entries and map standard Gateway/TWS ports; custom ports are retained. The owner confirmed the same IB credentials are used by selecting Paper Trading in Gateway. Credentials remain in Apple Passwords/Gateway, never Polytheta. The adapter detects a single authorized DU paper account, or uses optional local `IBKR_PAPER_ACCOUNT_ID`; live requires the exact local `IBKR_ACCOUNT_ID`.

Paper/live sessions must match Settings. Separate activation variables, mode journals and local backups prevent cross-account execution; legacy ownership is preserved. Paper fills stay in their journal/portfolio and do not enter the actual-trade ledger. Mode-mismatched equity and portfolio snapshots are rejected. See [operator guide](docs/ib_operations.md) and [regression tests](tests/paper-connection.test.mjs).

## Verification and remaining work

149 tests pass, including native Swift Codable round trips; lint has zero errors (21 existing warnings). Next production build passes. Native iOS/Watch simulator build passes using a generic iOS Simulator destination. Browser verification confirms paper selection switches Gateway port to 4002 and presents the correct login instructions.

Code commit `0f25703` is pushed. [Netlify production deploy](https://app.netlify.com/projects/polytheta/deploys/6aac0fb628a73c77bf66b05d) is live. Authenticated production API save/re-read verifies paper mode, port 4002, entries paused; the public guide is reachable. The clean release also passes all 149 tests. GitHub Actions deployment failed in the existing Neon build hook; a clean local Netlify build/deploy succeeded. This Mac is selected; both activation flags remain false. Read-only `npm run ib:check` reports IB error 502, reflected in production status as disconnected and not activated. Gateway was not listening; authentication and broker reads remain unverified. No orders were submitted. Native changes are compiled but not distributed to TestFlight. Preserve unrelated news-radar changes, launchd state and untracked baskets.

Next action: sign in to IB Gateway → Paper Trading with the existing IB login, enable the read-only socket API on port 4002, then run `npm run ib:check`. A useful fresh-task prompt is: “Read PROJECT_STATE.md and verify the signed-in IB paper connection without activating orders.”
