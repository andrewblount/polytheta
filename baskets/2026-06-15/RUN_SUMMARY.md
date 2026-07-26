# Weekly Refresh + Basket Build — 2026-06-15

**Run timestamp:** Sunday 2026-06-14 (autonomous scheduled task)
**Basket date:** 2026-06-15 (Monday)
**Expiry:** 2026-06-18 (Thursday) — Friday 2026-06-19 is Juneteenth, US markets closed.

## Steps executed

1. **Yahoo macro pull** — `scripts/_run_weekly_refresh_2026_05_11.mjs 2026-06-15 2026-06-19`
   Pulled 18 macro quotes (SPY, ^GSPC, ^VIX, ^SKEW, ^MOVE, ^OVX, ^RVX, QQQ, IWM, TLT, HYG, JNK, DXY, UUP, GLD, USO, XLE, XLF, XLK) + 180d history for SPY/^GSPC/^VIX.
2. **Universe quotes** — 679 weekly-options tickers fetched, 200 in the $8–$40 price band kept for chain processing.
3. **Option chains + IV** — `scripts/_chains_fix_2026_06_15.mjs` (a local fix on `_chains_parallel.mjs` that falls back to the nearest expiry within 4 days when Yahoo returns an empty options array for the literal target date). Expiry rolled to 2026-06-18.
   - Result: 200/200 tickers processed, 0 errors, 16,202 chain rows, 147 tickers with d18 best-call, 132 with d18 best-put.
4. **Filter + refine** — `scripts/_run_filter_refine_2026_04_27.mjs 2026-06-15`. 66 refined call candidates, 18 refined put candidates.
5. **Earnings filter** — `scripts/_fetch_earnings_dates_2026_05_11.mjs 2026-06-15 2026-06-18`. 69 tickers checked, 0 inside the 6/15–6/18 holding window.
6. **Basket build** — `scripts/_build_basket_2026_06_15_monday.mjs`. 8 picks selected and written to `data/basket_proposal.json`.

## Macro snapshot (close 2026-06-12)

| Series | Value | Notes |
|---|---|---|
| SPY | 741.75 | |
| ^GSPC | 7431.46 | |
| ^VIX | 17.68 | down -1.76 d/d (was 19.44) |
| ^SKEW | 142.60 | elevated |
| ^MOVE | 69.36 | benign rates vol |

**GSRS:** 2.78 — low-stress regime (VIX 1.92, SKEW 4.26, HYOAS 3.25 carryforward, MOVE 1.94, PC 3.15).

> **Note (assumption):** HY OAS and Put/Call were not in the Yahoo macro pull. Last known values (HY_OAS = 2.86, PC = 0.55) were carried forward. The TradingView weekly downloader has not produced fresh output since 2026-04-19, so its macro fields could not be refreshed in this run — flagged here so the operator can rerun the TradingView downloader manually if a fresh HY_OAS/PC is needed before sizing.

## Picks (8)

### CALLS — sell OTM (bearish thesis on speculative / hyped names)

| Ticker | Px | K | Δ | Credit | Buf | IV | Contracts | Margin | Sector |
|---|---|---|---|---|---|---|---|---|---|
| POET | 12.53 | 15 | 0.17 | 0.285 | 1.32× | 194% | 308 | 54,978 | Photonics |
| BTDR | 17.83 | 21 | 0.18 | 0.425 | 1.68× | 187% | 218 | 55,045 | Crypto mining |
| CIFR | 24.50 | 27.5 | 0.19 | 0.440 | 1.13× | 137% | 172 | 54,868 | BTC mining + HPC |
| BB | 9.19 | 10.5 | 0.15 | 0.125 | 1.49× | 134% | 468 | 54,990 | Cybersecurity |

### PUTS — sell OTM (bullish thesis on real / strong large-caps)

| Ticker | Px | K | Δ | Credit | Buf | IV | Contracts | Margin | Sector |
|---|---|---|---|---|---|---|---|---|---|
| NOK | 14.80 | 13.5 | -0.15 | 0.165 | 1.17× | 103% | 301 | 54,932 | Telecom |
| DKNG | 29.00 | 27 | -0.12 | 0.175 | 1.38× | 70% | 138 | 54,855 | iGaming |
| CCL | 29.18 | 27 | -0.11 | 0.170 | 1.87× | 73% | 144 | 55,094 | Cruise/travel |
| TSCO | 31.25 | 30 | -0.20 | 0.250 | 1.10× | 55% | 105 | 55,125 | Specialty retail |

### Totals

- Call credit: $31,461; call margin: $219,881
- Put credit: $12,455; put margin: $220,006
- **Total credit: $43,916** on ~$439,887 total margin (~10% credit/margin).

## Earnings clearance

All 8 picks confirmed clear of the 2026-06-15..2026-06-18 holding window. Closest-after-expiry earnings: **CCL** 2026-06-23 (3 trading days past), **BB** 2026-06-25 (4 trading days past), **NOK** 2026-07-23.

## Files written

- `data/macro_quotes.csv`, `data/SPY_history.csv`, `data/GSPC_history.csv`, `data/VIX_history.csv`
- `data/universe_quotes.csv` (677 rows), `data/universe_8to40.csv` (200 rows)
- `data/chains_2026-06-18_v2.csv` (16,202 rows), `data/chain_summary_v2.csv` (200 rows)
- `data/shortlist_calls.csv`, `data/shortlist_puts.csv`, `data/shortlist_calls_refined.csv`, `data/shortlist_puts_refined.csv`
- `data/earnings_dates.json` (69 tickers)
- `data/basket_proposal.json`
