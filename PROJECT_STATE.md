# Polytheta project state

Last updated: 2026-09-24

## Identity and objective

Authoritative root: `/Users/andrewblount/Library/CloudStorage/Dropbox-BlueCielo/Andrew Blount/development/polytheta` (the `~/Library/CloudStorage/Dropbox/development/polytheta` copy is stale, HEAD 9b1874a; do not work there). GitHub `andrewblount/polytheta`, branch `main`; production `https://polytheta.com`, Netlify site `7c943fa5-689b-484d-abd0-5c506cf8843d`. Next.js website, local Node IB worker, native sources under `ios/`.

## Model first, trading second (2026-09-24, commits a1f88e8, 35a7663, 39fdfce)

The weekly basket is a model and is generated every week whatever the IB account is doing. Removed from basket generation: execution-host authority, IB equity as the sizing basis, IB market data in finalization, and the "no late basket" rule. `scripts/run_weekly_basket.mjs` finalizes on Yahoo/Cboe/FRED/radar data, sizes against `POLYTHETA_MODEL_EQUITY` (50,000 in `.env.local`), and publishes to the database; a basket finalized after the entry window is published late with its true pricing time (`late`, `late_minutes`) through the last session before expiry (`shared/entry-schedule.mjs` `modelPublicationWindow`, `buildContext`). The published proposal is stored in `app_settings` as `model_basket:<week>`; `scripts/broker/worker.mjs` reads it from there (local file fallback) and keeps its own strict entry window and live-quote checks. The paper-only `POLYTHETA_MANUAL_LATE_ENTRY` override was removed. Fills from either IB account are ledgered in `trades` with `position_id` set, labelled `IBKR paper` / `IBKR live`.

Every basket carries a generated trading thesis and provenance in `basket_metrics.other_metrics` (`thesis`, `data_provenance`, `late`, `entry_timestamp`, `model_equity`, `reconstruction`) via `shared/basket-thesis.mjs`; `scripts/backfill_thesis.mjs` wrote theses for the 23 baskets in the database. Web: thesis card on `/app/baskets/<slug>`, account track on `/app/performance` (`src/server/repos/account-performance.ts`: execution rate, slippage vs modeled credit, fees, actual P&L per IB account). Mobile API: `leanBasket` now includes `thesis`, `model`, `notes`; `/api/mobile/performance` includes `account`. iOS 1.7.0 build 12 (TestFlight, processed, internal group "Andrew"): thesis section on every archive basket and the dashboard, account section on Performance.

Missing weeks recreated and published: 2026-09-07 (reconstructed, entry Tue 2026-09-08 09:45, 4 calls, settled +$264), 2026-09-14 (reconstructed, 7 calls, settled +$145), 2026-09-21 (rebuilt from the model's own 10:29 ET snapshot, 8 calls, late by 1 minute, expires 2026-09-25). Reconstructed weeks use real intraday underlying prices with Black-Scholes option quotes on the neighbouring weeks' IV surfaces (`scripts/lib/synthetic_chain.mjs`, `scripts/reconstruct_model_basket.mjs`); rebuilt weeks use observed snapshot quotes (`scripts/rebuild_model_basket.mjs`). Inputs are kept under `baskets/<week>/reconstruction|rebuild/` (gitignored). September baskets are sized at $50k model equity and are not comparable in dollars with the legacy $55k-per-name August baskets.

## Sizing sliders (2026-09-24)

The percentage settings (account traded 0–100%, margin available 100–1000%) are sliders in the web settings cards, on the web performance page and in the iOS Performance tab and settings sections. The performance API and report now carry `source` (every published leg with its settled outcome); `computeModelPerformance(source, settings)` in `src/lib/model-sizing.ts` is the single sizing engine (the server report wraps it; `resizeLeg` is re-exported from `src/server/repos/performance.ts`), and `ios/Sources/ModelSizing.swift` is its port. Clients recalculate the whole track record locally as the slider moves and save the model settings on release (`saveModelSettingsAction` on the web, `updateModelSettings` on the phone). The IB account section never changes with the sliders. TestFlight build 15.

## Known gaps

- Account performance has no data until the execution service records fills.
- The Sep 7 HY OAS input (2.63) is interpolated between FRED 2026-08-28 and 2026-09-11 because FRED was unreachable at rebuild time; GSRS sensitivity is about 0.02.
- Reconstructed weeks could not evaluate the historical news radar (treated as clean) or detect a past earnings print inside the hold window; both are disclosed in the basket's provenance note.
- `xcodebuild` cannot archive from the Dropbox path (space and parentheses in `Dropbox-BlueCielo (9-21-26 3:47 PM)`); TestFlight releases are built from a local clone at `~/Developer/polytheta-release` (re-clone before each release; copy `.env.local`).
- IB paper account: connected, $50k, no positions; execution for 2026-09-21 is closed (window passed). Next model run: Friday 2026-09-25 14:30 ET prepares 2026-09-28; Monday 09:35 ET finalizes.

## Access moderation, September 17

Unchanged: eight access requests pending; `fblount@biocurrent.com` absent; no account created. Private backup: `/Users/andrewblount/.local/state/polytheta/access-review-2026-09-17/`.
