# Polytheta project state

Last updated: 2026-09-17

## Identity and objective

Authoritative root: `/Users/andrewblount/Library/CloudStorage/Dropbox/development/polytheta`; GitHub `andrewblount/polytheta`, branch `main`; production `https://polytheta.com`, Netlify site `7c943fa5-689b-484d-abd0-5c506cf8843d`. Next.js website, local Node IB worker, native sources under `ios/`. Current objective: use the newly subscribed IBKR data and Paper Trading for the September 21–25 basket.

## Decisions and implementation

This Mac is selected, paper mode uses Gateway port 4002, and entries are unpaused. Local paper activation is true and `POLYTHETA_PAPER_ENTRY_WEEK=2026-09-21` limits new entries to that basket; live activation remains false. Entry window: September 21, 09:45–10:30 ET; preparation starts September 18 at 14:30 ET, finalization September 21 at 09:35 ET. Existing schedules run execution every 30 seconds and preparation every 60 seconds. Week limits do not disable paper-position exits.

Connected basket finalization now requires exact IB option/underlying quotes, IV and Greeks and records contract IDs/source/timestamps. Invalid, stale, delayed or frozen data blocks finalization without a Yahoo quote fallback. Research/history, earnings, news and macros retain existing sources. Dedicated read client 97 avoids execution client 96. `npm run ib:data -- --help` describes the read-only data probe. Activated cycles now retain paper mode/account equity; invalid IB Greek sentinels are rejected. Paper journals, portfolio and fills remain isolated from live accounting. See [operator guide](docs/ib_operations.md).

## Verification and remaining work

155 tests pass in the working and clean release trees, including native settings round trips. Full lint has zero errors (21 existing warnings). Gateway is open with Paper Trading selected and awaiting login. Both account and data probes return IB error 502; paper account/equity, subscription sharing, real-time quotes and margin remain unverified. No orders were submitted. No September 21 basket is finalized; the last research refresh completed but produced no qualifying basket. Code `9aa21b6` is pushed; GitHub checks/deployment succeeded. [Verified production release](https://app.netlify.com/projects/polytheta/deploys/6aac5fae26d8e69fc4ea5960) is ready; the live guide matches exactly and authenticated settings confirm the configuration above. Prior native changes compile but are not distributed to TestFlight. Preserve unrelated news-radar edits, AGENTS.md, launchd state and untracked baskets.

Configuration backup, release receipt and verification logs: `/Users/andrewblount/.local/state/polytheta/paper-2026-09-21/`. Latest data probe: private `runtime/ib-market-data-check.json`.

## Access moderation, September 17

Verified the local database matches Netlify production. Rejected 256 reviewed spam requests in one guarded transaction and verified every status afterward. Eight remain pending: six QA fixtures, Alfred Berkeley's product inquiry, and an ambiguous inquiry. The requested `fblount@biocurrent.com` is absent from all access requests, database profiles, and the Netlify Identity user list; approval awaits address clarification. No account was created. Private backup, decisions and receipt: `/Users/andrewblount/.local/state/polytheta/access-review-2026-09-17/`.

Next action: finish IB Gateway paper login, verify account/equity and an exact real-time option with `ib:check` and `ib:data`, then confirm paper API order access/margin before Monday. Authentication is pending with the owner; no credentials belong in chat or Git.
