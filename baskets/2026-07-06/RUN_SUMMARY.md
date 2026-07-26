# Weekly Refresh + Basket Build — 2026-07-06

**Run timestamp:** Sunday 2026-07-05 (autonomous scheduled task)
**Basket date:** 2026-07-06 (Monday entry)
**Expiry:** **Friday 2026-07-10** — standard weekly expiry, first full 5-day week following the July 4 holiday. (Verified: `yf.options(...)` on AAPL/SPY/SOFI/AAL returns 2026-07-10 as a valid expiry.)

## Steps executed

1. **Yahoo Python downloader** — *SKIPPED*. Same as prior weeks: the user's local Python venv (`python/yahoo_equity_downloader/.venv`) is hardcoded to macOS filesystem paths and requires Python 3.11; the sandbox has Python 3.10 only. The JS pipeline below fetches the equivalent Yahoo data through `yahoo-finance2`, so per-basket data is complete; only the top-level `data/` archive was not refreshed.
2. **TradingView downloader** — *SKIPPED*. Requires the user's local browser cookie store (Chrome/Edge profile) + the same Python 3.11 venv. The TradingView macro fields (HY_OAS, PC) remain at last-known values used in prior weeks (HY_OAS = 2.86, PC = 0.55) — see GSRS note below.
3. **Yahoo macro pull** — `scripts/_run_weekly_refresh_2026_07_06.mjs` (wrapper around `scripts/run_weekly_refresh.mjs` with `today` pinned to Sun 2026-07-05T12:00Z so `nextMonday`/`nextFriday` resolve to 2026-07-06 / 2026-07-10). Pulled 18 macro quotes (SPY, ^GSPC, ^VIX, ^SKEW, ^MOVE, ^OVX, QQQ, IWM, TLT, HYG, JNK, DXY, UUP, GLD, USO, XLE, XLF, XLK) + 180d history for SPY/^GSPC/^VIX. ^RVX was in the input list but was not returned by Yahoo this cycle; DXY quote came back with a null price.
4. **Universe quotes** — 674 weekly-options tickers fetched, **200** in the $8–$40 price band kept for chain processing.
5. **Option chains + IV** — `scripts/_chains_chunk_2026_07_06.mjs` with `EXPIRY_ISO=2026-07-10`. Chunked into 40-ticker batches to fit the sandbox per-call timeout.
   - Final result: **200/200 tickers processed, 0 errors, 12,058 chain rows**.
6. **Filter + refine** — `scripts/_filter_shortlist_2026_07_06.mjs` (125 call / 108 put candidates) → `scripts/_refine_shortlist_2026_07_06.mjs` (83 refined call / 55 refined put candidates after ETF, ATR, IV-cap, and liquidity filters).
7. **Earnings filter** — `scripts/_fetch_earnings_dates.mjs 2026-07-06`. 95 tickers checked, **1 inside the 7/06..7/10 holding window**: `BMNR` (2026-07-06) — excluded. (The `_fetch_earnings_dates.mjs` script has a hardcoded HOLD_START/HOLD_END from April and prints stale flags for that window; the true 2026-07-06..2026-07-10 window was re-checked in `earnings_dates.json` after the fetch.)
8. **Basket build** — `scripts/_build_basket_2026_07_06_monday.mjs`. 8 picks selected and written to `data/basket_proposal.json`.

## Macro snapshot (close 2026-07-02 — Fri 7/3 was closed for Independence Day)

| Series | Value | Notes |
|---|---|---|
| SPY | 744.78 | up from 728.99 last week (+2.2%) |
| ^GSPC | 7483.24 | back near recent highs |
| ^VIX | 15.81 | down from 18.41 last week (-2.60) — vol crush after holiday-shortened week |
| ^SKEW | 150.02 | up from 139.40 — tail-hedge demand elevated relative to spot |
| ^MOVE | 65.40 | benign rates vol, roughly flat |

**GSRS:** 2.70 — low-stress regime (VIX 1.45, SKEW 5.00, HYOAS 3.25 carryforward, MOVE 1.54, PC 3.15). Very similar to last week (2.76); VIX relief offset by higher SKEW.

> **Note (assumption):** HY OAS and Put/Call were not in the Yahoo macro pull. Last known values (HY_OAS = 2.86, PC = 0.55) were carried forward from prior runs because the TradingView downloader could not run in this sandbox (see step 2). If a fresh HY_OAS/PC reading is needed before sizing, operator should rerun the TradingView downloader locally and rebuild the basket — the GSRS recomputes from those inputs.

## Picks (8)

### CALLS — sell OTM (bearish thesis on speculative / hyped names)

| Ticker | Px | K | Δ | Credit | Buf | IV | Contracts | Margin | Sector |
|---|---|---|---|---|---|---|---|---|---|
| CIFR | 20.04 | 23.5 | 0.18 | 0.335 | 1.28× | 144% | 205 | 55,043 | BTC mining + HPC |
| POET | 8.76 | 10.5 | 0.16 | 0.130 | 1.31× | 149% | 466 | 54,988 | Photonics |
| WULF | 21.18 | 25.0 | 0.17 | 0.325 | 1.72× | 143% | 195 | 55,088 | BTC mining + HPC |
| RGTI | 17.94 | 20.5 | 0.18 | 0.250 | 1.41× | 121% | 239 | 54,970 | Quantum compute |

### PUTS — sell OTM (bullish thesis on real / strong names)

| Ticker | Px | K | Δ | Credit | Buf | IV | Contracts | Margin | Sector |
|---|---|---|---|---|---|---|---|---|---|
| NOK | 12.07 | 11.0 | -0.17 | 0.130 | 1.26× | 91% | 373 | 54,980 | Large-cap telecom-equip |
| KLAR | 19.72 | 18.5 | -0.21 | 0.225 | 1.03× | 75% | 187 | 55,146 | Consumer fintech |
| HIMS | 36.80 | 33.5 | -0.19 | 0.520 | 1.16× | 102% | 120 | 54,960 | Consumer health |
| DKNG | 25.89 | 24.0 | -0.17 | 0.245 | 1.36× | 76% | 156 | 55,115 | Gaming / large-cap |

### Totals

- Call credit: $25,239; call margin: $220,089
- Put credit: $19,119; put margin: $220,201
- **Total credit: $44,358** on ~$440,290 total margin (~10.1% credit/margin).
- Above last week's $41,899 (which was a holiday-shortened 4-day week Mon→Thu). This week is a full 5-day Mon→Fri hold, so per-cycle theta capture is larger even though IVs are similar or slightly lower on most names.

## Earnings clearance

All 8 picks confirmed clear of the 2026-07-06..2026-07-10 holding window. Universe-wide earnings inside the window: 1 ticker (`BMNR` 2026-07-06) — excluded before pick selection. Confirmed next earnings for the basket: **NOK** 2026-07-23, **DKNG** 2026-08-05, **CIFR / WULF** 2026-08-06, **HIMS** 2026-08-10, **POET** 2026-08-11, **KLAR** 2026-08-13. **RGTI:** Yahoo `calendarEvents` returned `2026-05-11` (stale — prior quarter); no future earnings reported in the holding window, so the hard filter passes. Manual verification of RGTI's next Q print date is recommended before placement.

## Week-over-week notes

- **Same 8 names as last week's basket.** Refined shortlists this week validated the same top-of-list picks: CIFR/POET/WULF/RGTI still top the IV-ranked call side, and NOK/KLAR/HIMS/DKNG still top the put side with real-business theses and adequate buffers.
- **Strikes rolled to track new spot prices.** POET call K rolled 11.0 → 10.5 (spot 9.44 → 8.76). CIFR K rolled 29.5 → 23.5 (spot 25.94 → 20.04). WULF K rolled 29.0 → 25.0 (spot 25.83 → 21.18). HIMS put K rolled 31.0 → 33.5 (spot 33.94 → 36.80). NOK put K rolled 12.0 → 11.0 (spot 13.01 → 12.07).
- **Full 5-day cycle vs. last week's 4-day cycle** means larger contracts on the same margin envelope and higher headline credits. Per-day yield is comparable to last week.
- **Macro is slightly more bullish:** VIX -2.6, SPY +2.2%. SKEW ticked up 10.6 points — tail-hedge demand is elevated relative to the low VIX print, which is typical when spot rallies into resistance. Net GSRS ~flat at 2.70.

## Files written

- `data/macro_quotes.csv`, `data/SPY_history.csv`, `data/GSPC_history.csv`, `data/VIX_history.csv`
- `data/universe_quotes.csv` (674 rows), `data/universe_8to40.csv` (200 rows)
- `data/chains_2026-07-10_v2.csv` (12,058 rows), `data/chain_summary_v2.csv` (200 rows)
- `data/shortlist_calls.csv`, `data/shortlist_puts.csv`, `data/shortlist_calls_refined.csv`, `data/shortlist_puts_refined.csv`
- `data/earnings_dates.json` (95 tickers)
- `data/basket_proposal.json`

## Scripts created for this run

- `scripts/_run_weekly_refresh_2026_07_06.mjs` (wrapper, pins `today` to 2026-07-05 12:00Z)
- `scripts/_chains_chunk_2026_07_06.mjs` (chunked chains+IV worker, expiry 2026-07-10)
- `scripts/_filter_shortlist_2026_07_06.mjs`, `scripts/_refine_shortlist_2026_07_06.mjs` (path-rewritten clones of last week's, now with `path.resolve` autodiscovery instead of a hardcoded session path)
- `scripts/_build_basket_2026_07_06_monday.mjs`
