# Weekly Refresh + Basket Build — 2026-06-22

**Run timestamp:** Monday 2026-06-22 (autonomous scheduled task)
**Basket date:** 2026-06-22 (Monday)
**Expiry:** 2026-06-26 (Friday weekly)

## Steps executed

1. **Yahoo Python downloader** — *SKIPPED*. The user's local Python venv (`python/yahoo_equity_downloader/.venv`) is hardcoded to macOS filesystem paths and requires Python 3.11; the run environment has only Python 3.10. The JS pipeline below fetches the equivalent Yahoo data through the `yahoo-finance2` npm package, so the per-basket data is complete — only the top-level `data/` archive was not refreshed.
2. **TradingView downloader** — *SKIPPED*. Requires the user's local browser cookie store (Chrome/Edge profile) plus the same Python 3.11 venv. The TradingView macro fields (HY_OAS, PC) remain at the last-known values used in prior weeks (HY_OAS = 2.86, PC = 0.55) — see GSRS note below.
3. **Yahoo macro pull** — `scripts/_run_weekly_refresh_2026_06_22.mjs` (wrapper around `scripts/run_weekly_refresh.mjs` with the basket date pinned). Pulled 18 macro quotes (SPY, ^GSPC, ^VIX, ^SKEW, ^MOVE, ^OVX, ^RVX, QQQ, IWM, TLT, HYG, JNK, DXY, UUP, GLD, USO, XLE, XLF, XLK) + 180d history for SPY/^GSPC/^VIX.
4. **Universe quotes** — 676 weekly-options tickers fetched, **206** in the $8–$40 price band kept for chain processing.
5. **Option chains + IV** — `scripts/_chains_chunk_2026_06_22.mjs` (chunked execution of the same logic in `run_weekly_refresh.mjs` step 3 so it fits inside the sandbox's per-call timeout). Expiry 2026-06-26.
   - Result: **206/206 tickers processed, 0 errors, 12,254 chain rows**.
6. **Filter + refine** — `scripts/_filter_shortlist_2026_06_22.mjs` (127 call / 115 put candidates) → `scripts/_refine_shortlist_2026_06_22.mjs` (80 refined call / 51 refined put candidates after ETF, ATR, IV-cap, and liquidity filters).
7. **Earnings filter** — `scripts/_fetch_earnings_dates.mjs 2026-06-22`. 99 tickers checked, **2 inside the 6/22–6/26 holding window**: `BB` (2026-06-25) and `CCL` (2026-06-23) — both excluded.
8. **Basket build** — `scripts/_build_basket_2026_06_22_monday.mjs`. 8 picks selected and written to `data/basket_proposal.json`.

## Macro snapshot (close 2026-06-19)

| Series | Value | Notes |
|---|---|---|
| SPY | 746.74 | |
| ^GSPC | 7500.58 | new high band |
| ^VIX | 16.78 | up +0.38 d/d (was 16.40) |
| ^SKEW | 146.72 | elevated — tail hedging persistent |
| ^MOVE | 65.39 | benign rates vol |

**GSRS:** 2.81 — low-stress regime (VIX 1.89, SKEW 4.67, HYOAS 3.25 carryforward, MOVE 1.54, PC 3.15).

> **Note (assumption):** HY OAS and Put/Call were not in the Yahoo macro pull. Last known values (HY_OAS = 2.86, PC = 0.55) were carried forward from the 2026-06-15 run because the TradingView downloader could not run in this sandbox (see step 2). If a fresh HY_OAS/PC reading is needed before sizing, operator should rerun the TradingView downloader locally and rebuild the basket — the GSRS recomputes from those inputs.

## Picks (8)

### CALLS — sell OTM (bearish thesis on speculative / hyped names)

| Ticker | Px | K | Δ | Credit | Buf | IV | Contracts | Margin | Sector |
|---|---|---|---|---|---|---|---|---|---|
| POET | 12.15 | 14.5 | 0.19 | 0.235 | 1.22× | 163% | 325 | 54,925 | Photonics |
| NVTS | 24.02 | 28.5 | 0.19 | 0.470 | 1.35× | 158% | 166 | 55,029 | GaN power semis |
| CIFR | 29.18 | 34.0 | 0.17 | 0.440 | 1.81× | 135% | 143 | 54,912 | BTC mining + HPC |
| RGTI | 21.36 | 24.5 | 0.18 | 0.330 | 1.29× | 127% | 198 | 54,945 | Quantum compute |

### PUTS — sell OTM (bullish thesis on real / strong names)

| Ticker | Px | K | Δ | Credit | Buf | IV | Contracts | Margin | Sector |
|---|---|---|---|---|---|---|---|---|---|
| CDE | 17.51 | 16.0 | -0.16 | 0.170 | 1.19× | 87% | 254 | 55,042 | Precious-metals mining |
| KLAR | 18.84 | 17.0 | -0.15 | 0.200 | 1.79× | 96% | 258 | 54,902 | Consumer fintech |
| SOFI | 17.91 | 16.5 | -0.14 | 0.135 | 1.40× | 71% | 239 | 54,898 | Large-cap fintech |
| RKT | 14.42 | 13.5 | -0.22 | 0.190 | 1.04× | 81% | 255 | 54,927 | Large-cap mortgage |

### Totals

- Call credit: $28,246; call margin: $219,811
- Put credit: $17,438; put margin: $219,769
- **Total credit: $45,684** on ~$439,580 total margin (~10.4% credit/margin).

## Earnings clearance

All 8 picks confirmed clear of the 2026-06-22..2026-06-26 holding window. Universe-wide earnings inside the window: 2 tickers (`BB` 2026-06-25, `CCL` 2026-06-23) — both excluded before pick selection. Closest-after-expiry earnings for the basket: **SOFI** 2026-07-28, **RKT** 2026-07-30, **NVTS** 2026-08-03, **CDE** 2026-08-05, **CIFR** 2026-08-06, **POET** 2026-08-11, **KLAR** 2026-08-13.

## Files written

- `data/macro_quotes.csv`, `data/SPY_history.csv`, `data/GSPC_history.csv`, `data/VIX_history.csv`
- `data/universe_quotes.csv` (676 rows), `data/universe_8to40.csv` (206 rows)
- `data/chains_2026-06-26_v2.csv` (12,254 rows), `data/chain_summary_v2.csv` (206 rows)
- `data/shortlist_calls.csv`, `data/shortlist_puts.csv`, `data/shortlist_calls_refined.csv`, `data/shortlist_puts_refined.csv`
- `data/earnings_dates.json` (99 tickers)
- `data/refresh_manifest.json`
- `data/basket_proposal.json`

## Scripts created for this run

- `scripts/_run_weekly_refresh_2026_06_22.mjs` (wrapper)
- `scripts/_chains_chunk_2026_06_22.mjs` (chunked chains+IV worker)
- `scripts/_filter_shortlist_2026_06_22.mjs`, `scripts/_refine_shortlist_2026_06_22.mjs`
- `scripts/_build_basket_2026_06_22_monday.mjs`
