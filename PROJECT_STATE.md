# Polytheta project state

Last updated: 2026-09-21

## Identity and objective

Authoritative root: `/Users/andrewblount/Library/CloudStorage/Dropbox-BlueCielo/Andrew Blount/development/polytheta`; `/Users/andrewblount/Local/development/polytheta` resolves to it. The old `Dropbox/development/polytheta` path is absent. GitHub `andrewblount/polytheta`, branch `main`; production `https://polytheta.com`, Netlify site `7c943fa5-689b-484d-abd0-5c506cf8843d`. Next.js website, local Node IB worker, native sources under `ios/`. Objective: finish IBKR paper execution and market-data verification.

## Current operating state

Gateway now listens on port 4002. A read-only diagnostic using separate client 98 authenticated the paper account and obtained valid NetLiquidation on September 21. No orders were sent by that diagnostic. The owner’s Gateway screenshot shows Read-Only API blocking a request; scheduled execution logs show response timeouts. Full reconciliation, subscribed real-time quotes and margin remain unverified.

Saved settings remain paper/IBKR, entries unpaused, paper activation true, live activation false. `POLYTHETA_PAPER_ENTRY_WEEK=2026-09-21` restricts new entries; exits remain enabled for owned paper positions. This week’s 09:45–10:30 ET Monday window was missed: `baskets/2026-09-21/entry_preparation.json` reports preparation finished after its allowed session at 14:31:26 UTC, with no basket published. Do not force late entries or extend the authorized week implicitly. Execution/preparation schedules are loaded and point to the resolved root.

Finalization requires exact, fresh IB option/underlying quotes, IV and Greeks; no Yahoo execution-quote fallback. Data client 97 is separate from execution client 96. Paper journals and fills remain isolated. See [operator guide](docs/ib_operations.md).

## Verification and handoff

Prior release `9aa21b6`: 155 tests passed, lint zero errors (21 existing warnings), GitHub deployment succeeded. These checks were not repeated for this diagnostic. Current HEAD includes subsequent heartbeat work. Preserve concurrent adapter-utils/news-radar edits, AGENTS.md, launchd state and untracked baskets. Native TestFlight distribution remains outstanding.

Evidence/configuration receipts: `/Users/andrewblount/.local/state/polytheta/paper-2026-09-21/`. Next action: in the confirmed paper Gateway session, disable Read-Only API and apply; then rerun account reconciliation, verify subscribed data during an open session, and validate paper margin/order access. This does not reopen today’s missed entry window.

## Access moderation, September 17

Verified the local database matches Netlify production. Rejected 256 reviewed spam requests in one guarded transaction and verified every status afterward. Eight remain pending: six QA fixtures, Alfred Berkeley's product inquiry, and an ambiguous inquiry. The requested `fblount@biocurrent.com` is absent from all access requests, database profiles, and the Netlify Identity user list; approval awaits address clarification. No account was created. Private backup, decisions and receipt: `/Users/andrewblount/.local/state/polytheta/access-review-2026-09-17/`.
