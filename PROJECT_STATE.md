# Polytheta project state

Last updated: 2026-09-21

## Identity and objective

Authoritative root: `/Users/andrewblount/Library/CloudStorage/Dropbox-BlueCielo/Andrew Blount/development/polytheta`; `/Users/andrewblount/Local/development/polytheta` resolves to it. The old `Dropbox/development/polytheta` path is absent. GitHub `andrewblount/polytheta`, branch `main`; production `https://polytheta.com`, Netlify site `7c943fa5-689b-484d-abd0-5c506cf8843d`. Next.js website, local Node IB worker, native sources under `ios/`. Objective: complete IBKR paper execution and subscribed-data verification.

## Current operating state

Earlier September 21 tests passed Gateway paper authentication on port 4002, equity, positions, orders, fills and guarded what-if margin. No positions/fills were found or executable orders submitted. Live activation remains false. Gateway has now been restarted for the dedicated paper username from the owner’s screenshot; Paper Trading and the username are prepared. The owner did not know the paper password, so the live Client Portal’s separate paper-password reset form is open and focused; owner password entry/reset and Gateway login are pending.

Testing found and fixed two TWS adapter bugs: normalize decorated contract expiry dates before reuse, and wait for the actual margin response after IB's preliminary acknowledgement. Real API retesting passed contract resolution and margin calculation. Enabled live-to-paper market-data sharing in Client Portal, saved it, reloaded and verified persistence. The portal paper account matches PolyTheta’s authenticated account. Immediate stock and option probes still returned 354; subscription propagation and a fresh dedicated-paper login remain to be verified.

Settings remain paper/IBKR, entries unpaused, paper activation true. `POLYTHETA_PAPER_ENTRY_WEEK=2026-09-21` restricts new entries; existing paper exits remain enabled. This week's Monday 09:45–10:30 ET entry window was missed; preparation ended at 14:31:26 UTC without publishing a basket. Do not force late entries or extend the week implicitly. Schedules point to the resolved root. Finalization requires fresh IB option/underlying quotes and Greeks, with no Yahoo execution-quote fallback. Data client 97 is separate from worker 96; diagnostics used 98.

## Verification and next action

Both regressions were reproduced before their fixes. All 156 tests pass; lint has zero errors and 21 existing warnings. Evidence, before/after probes and logs: `/Users/andrewblount/.local/state/polytheta/paper-2026-09-21/connection-tests/`. See [operator guide](docs/ib_operations.md). Sharing receipt: `connection-tests/sharing-enabled.json` within that evidence directory. Next: owner sets the paper password in the prepared Client Portal form and completes Gateway login, then rerun account and stock/options data probes; only fresh open-session quotes establish execution readiness. This does not reopen the missed entry window.

Preserve concurrent adapter-utils/news-radar edits, AGENTS.md, launchd state and untracked baskets. Native TestFlight distribution remains outstanding.

## Access moderation, September 17

Verified the local database matches Netlify production. Rejected 256 reviewed spam requests in one guarded transaction and verified every status afterward. Eight remain pending: six QA fixtures, Alfred Berkeley's product inquiry, and an ambiguous inquiry. The requested `fblount@biocurrent.com` is absent from all access requests, database profiles, and the Netlify Identity user list; approval awaits address clarification. No account was created. Private backup, decisions and receipt: `/Users/andrewblount/.local/state/polytheta/access-review-2026-09-17/`.
