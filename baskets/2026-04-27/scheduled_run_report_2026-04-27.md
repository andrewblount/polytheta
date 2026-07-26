# Scheduled Run Report — 2026-04-27 (Monday Entry, Earnings-Filtered)

**Task:** `update-stock-data-and-generate-trades`
**Initial run:** 2026-04-27 15:31 UTC (POET breach swap only)
**Earnings-filter rebuild:** 2026-04-27 16:05 UTC (after Andrew flagged GLXY)
**Target basket:** Monday 2026-04-27 entry / Friday 2026-05-01 expiry

---

## TL;DR

- The first iteration of this run produced a basket that contained **6 names with earnings during the holding period**. After Andrew flagged GLXY (earnings Tue 4/28), I pulled scheduled earnings dates for all 84 candidate tickers from Yahoo's `quoteSummary.calendarEvents` and re-screened.
- Only **2 of the 8 names** in the previous draft were earnings-clean: NN (call) and SMR (put).
- Replaced 6 names with earnings-clean alternatives from the refined shortlist. Final basket: **NN, NVTS, ASST, BTDR (calls) + SMR, CORZ, TTD, SOC (puts).**
- Hardened the basket builder so any future ticker with earnings between basket_date and expiry is **rejected at build time**. The script `process.exit(1)`s if a candidate trips the filter, so the bad case can't silently re-enter.
- TradingView download still skipped (same macOS-venv issue as the 2026-04-24 run).

---

## What ran

| Step | Script | Result |
|---|---|---|
| 1. Macro quotes + SPY/SPX/VIX history | `scripts/_run_weekly_refresh_2026_04_27.mjs` (step 1) | 18 macro tickers, 123–129 bars each |
| 2. Universe quotes (CBOE weeklys) | `scripts/_run_weekly_refresh_2026_04_27.mjs` (step 2) | 678 / 679 tickers (0 errors), 199 in $8–$40 band |
| 3. Option chains + IV summary | `scripts/_chains_parallel.mjs 2026-04-27` | 199 / 199 tickers (0 errors) |
| 4. Shortlist + refine | `scripts/_run_filter_refine_2026_04_27.mjs 2026-04-27` | 79 call candidates / 40 put candidates |
| 5. **Earnings dates fetch** | **`scripts/_fetch_earnings_dates.mjs 2026-04-27` (NEW)** | 84 tickers, 14 with earnings 4/27–5/1 |
| 6. **Earnings filter + rerank** | **`scripts/_filter_earnings_and_rank.mjs 2026-04-27 ...` (NEW)** | 65 calls / 30 puts surviving |
| 7. Basket proposal rebuild | `scripts/_build_basket_2026_04_27_monday.mjs` (now earnings-aware) | 4 calls + 4 puts; hard fail if any candidate has conflicting earnings |

## Names excluded for earnings during 2026-04-27 → 2026-05-01

Pulled from `calendarEvents.earnings.earningsDate`:

| Ticker | Earnings Date | Was in… |
|---|---|---|
| GLXY | 2026-04-28 (Tue) | first draft (call $28.5) — Andrew's flag |
| ENPH | 2026-04-28 (Tue) | first draft (call $41) — also flagged in basket markdown's "earnings risk" note |
| AR   | 2026-04-29 (Wed) | shortlist only |
| CMG  | 2026-04-29 (Wed) | shortlist only |
| KGC  | 2026-04-29 (Wed) | shortlist only |
| **SOFI** | 2026-04-29 (Wed) | first draft (put $17) — the POET replacement I picked, also reports |
| TEVA | 2026-04-29 (Wed) | shortlist only |
| VKTX | 2026-04-29 (Wed) | shortlist only |
| BAX  | 2026-04-30 (Thu) | shortlist only |
| RIOT | 2026-04-30 (Thu) | first draft (put $16.5) |
| RIVN | 2026-04-30 (Thu) | first draft (call $18.5) |
| SIRI | 2026-04-30 (Thu) | shortlist only |
| SMMT | 2026-04-30 (Thu) | shortlist only |
| ZETA | 2026-04-30 (Thu) | first draft (put $16.5) |

The reason these had high IV in the screener — the earnings event was IN the implied move. Selling that vol naked across the binary is exactly what the strategy is supposed to avoid. The screener's IV-rank metrics don't distinguish "elevated because of earnings binary" from "elevated because of structural realized vol." That's why the earnings filter has to be an explicit pre-pick gate.

## Macro snapshot (Monday 2026-04-27 open)

| Metric | Value | vs 2026-04-24 |
|---|---|---|
| SPY | 712.88 | −1.06 (−0.15%) |
| SPX | 7,152.14 | −12.94 (−0.18%) |
| VIX | 18.74 | +0.03 (essentially flat) |
| SKEW | 139.08 | −0.51 |
| MOVE | 66.97 | unchanged |
| HY OAS | 2.86% (carried) | — |

**GSRS = 2.80** → 0–3 band: full aggressive 5% sizing both sides; doubles enabled on both sides.

## POET breach (separate from the earnings issue)

POET dropped from $15.10 (Fri close) to $8.42 (Mon open), −44%. Friday's basket had POET $12 put — that's now $3.58 ITM at delta −0.85. POET is removed independent of the earnings filter (gap-risk breach). I did not investigate the cause from news/8-Ks; this should be checked before treating POET as a permanent removal.

## Final earnings-clean basket (8 names)

### Call side (bearish — sell OTM calls)
| Ticker | Px | Strike | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| NN   | 17.44 | 21 Call   | 0.45 | 0.60 | 0.53 | 0.19 | 1.94 | 1.83× | 197% | 98 | 5/06 | 210 | $55,125 |
| NVTS | 17.10 | 20 Call   | 0.42 | 0.45 | 0.43 | 0.19 | 1.60 | 1.81× | 168% | 22 | 5/05 | 226 | $55,031 |
| ASST | 15.38 | 18 Call   | 0.33 | 0.40 | 0.36 | 0.18 | 1.31 | 1.99× | 163% | 2  | 5/14 | 254 | $54,991 |
| BTDR | 11.20 | 13 Call   | 0.20 | 0.30 | 0.25 | 0.17 | 0.90 | 2.00× | 152% | 24 | 5/14 | 355 | $55,025 |

Call subtotal: ~$220,172 margin, ~$39,002 credit (mid).

### Put side (bullish — sell OTM puts)
| Ticker | Px | Strike | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SMR  | 12.13 | 11 Put   | 0.21 | 0.22 | 0.21 | −0.17 | 1.32 | 0.85× | 138% | 67 | 5/07 | 364 | $55,030 |
| CORZ | 20.69 | 19 Put   | 0.24 | 0.29 | 0.27 | −0.16 | 1.03 | 1.64× | 93%  | 17 | 5/06 | 203 | $55,074 |
| TTD  | 23.70 | 22 Put   | 0.21 | 0.25 | 0.23 | −0.14 | 1.23 | 1.39× | 76%  | 22 | 5/07 | 168 | $54,869 |
| SOC  | 13.94 | 12.5 Put | 0.22 | 0.28 | 0.25 | −0.16 | 1.04 | 1.38× | 124% | 21 | 5/07 | 343 | $54,949 |

Put subtotal: ~$219,922 margin, ~$25,645 credit (mid).

**Combined: ~$440,094 margin, ~$64,647 credit at mid (≈ 14.7% weekly credit/margin).**

### Buffer flags
- **SMR 0.85× ATR — well below 2× target.** The $11 strike is the new delta-0.18, but the $10.50 strike (last week's pick) gives 1.23× ATR with $0.125 mid; trade-off is ~$3,000 less credit on the name. Recommend reviewing before entry.
- TTD 1.39×, SOC 1.38× — below 2× target, common pattern this week given that the high-IV names mostly turned out to be earnings names that are now excluded.
- All call-side buffers ≥ 1.81× ATR; ASST and BTDR essentially at 2.0×.

## Sector composition note

Both BTDR (call) and CORZ (put) are BTC mining adjacent. With this strategy (vol-sell, not directional), sector overlap isn't a strict conflict but if BTC has a binary catalyst this week (FOMC 4/30 is mid-window — verify), expect correlated tails. Acceptable but flagged.

## What didn't run

**TradingView downloader and the Python `polytheta-yahoo-downloader`** — the project's `python/*/.venv` directories still point to a macOS interpreter path (`/Library/Frameworks/Python.framework/Versions/3.11/bin/python3`), so the venvs cannot execute in this Linux session sandbox. Same as last week. The TradingView script additionally needs `rookiepy` to read the user's local browser cookie jar, which would still fail in the sandbox after a venv rebuild. Run on local Mac to refresh.

Most recent TradingView snapshot remains `data_trading_view/2026-04-19 21-50-16_tradingview_weeklys.csv`.

## Files written / updated

- `baskets/2026-04-27/data/macro_quotes.csv` — fresh at 15:28 UTC
- `baskets/2026-04-27/data/{SPY,GSPC,VIX}_history.csv` — fresh at 15:28 UTC
- `baskets/2026-04-27/data/universe_quotes.csv` — fresh at 15:28 UTC (678 rows)
- `baskets/2026-04-27/data/universe_8to40.csv` — fresh at 15:28 UTC (199 rows)
- `baskets/2026-04-27/data/chains_2026-05-01_v2.csv` — fresh at 15:28 UTC
- `baskets/2026-04-27/data/chain_summary_v2.csv` — fresh at 15:28 UTC
- `baskets/2026-04-27/data/shortlist_calls{,_refined}.csv` — fresh at 15:29 UTC
- `baskets/2026-04-27/data/shortlist_puts{,_refined}.csv` — fresh at 15:29 UTC
- **`baskets/2026-04-27/data/earnings_dates.json` — NEW** (84 tickers, 14 flagged as in-window)
- **`baskets/2026-04-27/data/shortlist_calls_no_earnings.csv` — NEW** (65 survivors, ranked)
- **`baskets/2026-04-27/data/shortlist_puts_no_earnings.csv` — NEW** (30 survivors, ranked)
- `baskets/2026-04-27/data/basket_proposal.json` — REBUILT with earnings filter
- `baskets/2026-04-27/data/refresh_manifest.json` — updated for the rebuild
- **`scripts/_fetch_earnings_dates.mjs` — NEW** (Yahoo `calendarEvents` puller, concurrency-bounded)
- **`scripts/_filter_earnings_and_rank.mjs` — NEW** (filters refined shortlists + composite re-rank)
- `scripts/_build_basket_2026_04_27_monday.mjs` — UPDATED with hard earnings filter that exits non-zero if any candidate trips the gate

The **human-curated basket markdown** at `baskets/2026-04-27-basket.md` was **not modified**. It still reflects the original Friday selection (POET, ENPH, GLXY, RIVN, ZETA, RIOT, etc.). All 6 of those names with earnings this week, plus POET, would have been bad entries. Recommend rewriting that file from `basket_proposal.json` before placing any orders.

## Recommended permanent change to the screener

The pipeline should integrate earnings filtering into `scripts/_run_filter_refine_*.mjs` (or its successor) so the refined shortlist is earnings-clean by construction. Right now it's a post-hoc filter implemented in `_filter_earnings_and_rank.mjs`. Suggested:

1. Persist a `data/earnings_dates.json` (universe-wide, ~679 tickers) on every weekly refresh — same pattern as the macro/chain snapshots.
2. Add an `earnings_in_window` boolean to `chain_summary_v2.csv` so the column flows through the existing screener.
3. Change `_run_filter_refine_*.mjs` to drop rows where `earnings_in_window === true`.

Happy to make that change as a follow-up if you'd like — flagging here rather than doing it unprompted because it touches the canonical refresh path that the Friday cron also uses.

## Choices made without the user present

1. **Picked NVTS, ASST, BTDR (calls) and CORZ, TTD, SOC (puts) as replacements** — top of the earnings-clean rerank by composite (IV × buffer × credit). Diversification across small-cap/mid-cap, 1.4×–2.0× ATR buffers.
2. **Kept SMR's $11 strike (0.85× ATR) rather than reverting to $10.50.** The $11 is the live delta-0.18 with bid > 0; the $10.50 is technically allowed but yields only $0.125 mid which is borderline tradeable. Flagged for manual review.
3. **Hard-coded the earnings filter to exit non-zero** in the build script if any candidate has conflicting earnings, to prevent silent regression.
4. **Did not regenerate `2026-04-27-basket.md`** — that's the human-curated entry document and your call to overwrite.
5. **Did not place any orders.**
