# Weekly Refresh + Basket Build — 2026-06-29

**Run timestamp:** Monday 2026-06-29 (autonomous scheduled task)
**Basket date:** 2026-06-29 (Monday entry)
**Expiry:** **Thursday 2026-07-02** — Friday 2026-07-03 is closed for US Independence Day observance, so the weekly contract on Yahoo settles Thu 7/2. (Verified: probe of AAPL/SPY/SOFI/AAL on `yf.options(...)` returned 2026-07-02 as the available expiry; calls/puts for 2026-07-03 came back empty.)

## Steps executed

1. **Yahoo Python downloader** — *SKIPPED*. Same as prior weeks: the user's local Python venv (`python/yahoo_equity_downloader/.venv`) is hardcoded to macOS filesystem paths and requires Python 3.11; the run environment has only Python 3.10. The JS pipeline below fetches the equivalent Yahoo data through `yahoo-finance2`, so per-basket data is complete; only the top-level `data/` archive was not refreshed.
2. **TradingView downloader** — *SKIPPED*. Requires the user's local browser cookie store (Chrome/Edge profile) + the same Python 3.11 venv. The TradingView macro fields (HY_OAS, PC) remain at last-known values used in prior weeks (HY_OAS = 2.86, PC = 0.55) — see GSRS note below.
3. **Yahoo macro pull** — `scripts/_run_weekly_refresh_2026_06_29.mjs` (wrapper around `scripts/run_weekly_refresh.mjs` with `today` pinned to Sun 2026-06-28T12:00Z so `nextMonday`/`nextFriday` resolve to 2026-06-29 / 2026-07-03). Pulled 18 macro quotes (SPY, ^GSPC, ^VIX, ^SKEW, ^MOVE, ^OVX, ^RVX, QQQ, IWM, TLT, HYG, JNK, DXY, UUP, GLD, USO, XLE, XLF, XLK) + 180d history for SPY/^GSPC/^VIX.
4. **Universe quotes** — 676 weekly-options tickers fetched, **199** in the $8–$40 price band kept for chain processing.
5. **Option chains + IV** — initial run with `EXPIRY_ISO=2026-07-03` returned chain objects with **empty calls/puts arrays** (the date simply doesn't exist on Yahoo). Reset and re-ran `scripts/_chains_chunk_2026_06_29.mjs` with `EXPIRY_ISO=2026-07-02` (Thursday weekly). Chunked into 40-ticker batches to fit the sandbox per-call timeout.
   - Final result: **199/199 tickers processed, 0 errors, 11,531 chain rows**.
6. **Filter + refine** — `scripts/_filter_shortlist_2026_06_29.mjs` (116 call / 103 put candidates) → `scripts/_refine_shortlist_2026_06_29.mjs` (65 refined call / 31 refined put candidates after ETF, ATR, IV-cap, and liquidity filters).
7. **Earnings filter** — `scripts/_fetch_earnings_dates.mjs 2026-06-29`. 69 tickers checked, **1 inside the 6/29..7/02 holding window**: `BMNR` (2026-07-02) — excluded.
8. **Basket build** — `scripts/_build_basket_2026_06_29_monday.mjs`. 8 picks selected and written to `data/basket_proposal.json`.

## Macro snapshot (close 2026-06-26)

| Series | Value | Notes |
|---|---|---|
| SPY | 728.99 | down from 746.74 last week (~-2.4%) |
| ^GSPC | 7354.02 | off the high band (was 7500 last week) |
| ^VIX | 18.41 | up from 16.78 last week (+1.63) — modest risk-off |
| ^SKEW | 139.40 | down from 146.72 — tail-hedge demand softened |
| ^MOVE | 66.79 | benign rates vol, roughly flat |

**GSRS:** 2.76 — low-stress regime (VIX 2.10, SKEW 3.94, HYOAS 3.25 carryforward, MOVE 1.68, PC 3.15). Very similar to last week (2.81); VIX up offset by SKEW relief.

> **Note (assumption):** HY OAS and Put/Call were not in the Yahoo macro pull. Last known values (HY_OAS = 2.86, PC = 0.55) were carried forward from prior runs because the TradingView downloader could not run in this sandbox (see step 2). If a fresh HY_OAS/PC reading is needed before sizing, operator should rerun the TradingView downloader locally and rebuild the basket — the GSRS recomputes from those inputs.

## Picks (8)

### CALLS — sell OTM (bearish thesis on speculative / hyped names)

| Ticker | Px | K | Δ | Credit | Buf | IV | Contracts | Margin | Sector |
|---|---|---|---|---|---|---|---|---|---|
| CIFR | 25.94 | 29.5 | 0.20 | 0.435 | 1.34× | 141% | 162 | 54,837 | BTC mining + HPC |
| POET | 9.44 | 11.0 | 0.15 | 0.115 | 1.09× | 141% | 453 | 55,040 | Photonics |
| WULF | 25.83 | 29.0 | 0.17 | 0.315 | 1.39× | 118% | 171 | 54,977 | BTC mining + HPC |
| RGTI | 18.36 | 20.5 | 0.18 | 0.240 | 1.01× | 117% | 240 | 54,960 | Quantum compute |

### PUTS — sell OTM (bullish thesis on real / strong names)

| Ticker | Px | K | Δ | Credit | Buf | IV | Contracts | Margin | Sector |
|---|---|---|---|---|---|---|---|---|---|
| NOK | 13.01 | 12.0 | -0.17 | 0.130 | 1.12× | 91% | 319 | 54,932 | Large-cap telecom-equip |
| KLAR | 20.29 | 18.5 | -0.18 | 0.275 | 1.59× | 111% | 216 | 54,929 | Consumer fintech |
| HIMS | 33.94 | 31.0 | -0.18 | 0.455 | 1.11× | 110% | 128 | 55,078 | Consumer health |
| DKNG | 25.70 | 24.0 | -0.15 | 0.170 | 1.06× | 70% | 152 | 54,872 | Gaming / large-cap |

### Totals

- Call credit: $23,404; call margin: $219,814
- Put credit: $18,495; put margin: $219,811
- **Total credit: $41,899** on ~$439,625 total margin (~9.5% credit/margin).
- Slightly lower headline credit than last week's $45,684 — a function of the shorter holding window (4 calendar days vs. 5) plus modestly lower IV on some names; per-day yield is comparable.

## Earnings clearance

All 8 picks confirmed clear of the 2026-06-29..2026-07-02 holding window. Universe-wide earnings inside the window: 1 ticker (`BMNR` 2026-07-02) — excluded before pick selection. Confirmed next earnings for the basket: **NOK** 2026-07-23, **DKNG** 2026-08-05, **CIFR / WULF** 2026-08-06, **HIMS** 2026-08-10, **POET** 2026-08-11, **KLAR** 2026-08-13. **RGTI:** Yahoo `calendarEvents` returned `2026-05-11` (stale — prior quarter); no future earnings reported in the holding window, so the hard filter passes. Manual verification of RGTI's next Q3 print date is recommended before placement.

## Holiday-week notes

- **Expiry rolled from Fri 7/3 → Thu 7/2** for the full universe (US market closed Friday for July 4 observance).
- Holding period is **4 calendar days** instead of the usual 5 (Mon→Thu vs. Mon→Fri). This is reflected in the lower headline credits; theta capture is structurally smaller this cycle.
- Operator may want to size up contracts slightly to hit the same dollar yield, or accept the lower week and use the extra holiday day to roll early.

## Files written

- `data/macro_quotes.csv`, `data/SPY_history.csv`, `data/GSPC_history.csv`, `data/VIX_history.csv`
- `data/universe_quotes.csv` (676 rows), `data/universe_8to40.csv` (199 rows)
- `data/chains_2026-07-02_v2.csv` (11,531 rows), `data/chain_summary_v2.csv` (199 rows)
- `data/shortlist_calls.csv`, `data/shortlist_puts.csv`, `data/shortlist_calls_refined.csv`, `data/shortlist_puts_refined.csv`
- `data/earnings_dates.json` (69 tickers)
- `data/basket_proposal.json`

## Scripts created for this run

- `scripts/_run_weekly_refresh_2026_06_29.mjs` (wrapper, pins `today` to 2026-06-28 12:00Z)
- `scripts/_chains_chunk_2026_06_29.mjs` (chunked chains+IV worker, expiry 2026-07-02)
- `scripts/_filter_shortlist_2026_06_29.mjs`, `scripts/_refine_shortlist_2026_06_29.mjs` (path-rewritten clones of last week's)
- `scripts/_build_basket_2026_06_29_monday.mjs`
- `scripts/_check_earnings_2026_06_29.mjs` (sanity check of earnings window flagging, since `_fetch_earnings_dates.mjs` has a hardcoded HOLD_START/HOLD_END from April)
- `scripts/_probe_expiry_2026_06_29.mjs`, `scripts/_probe_chain_2026_06_29.mjs` (one-off diagnostics that confirmed the missing 7/3 expiry)
