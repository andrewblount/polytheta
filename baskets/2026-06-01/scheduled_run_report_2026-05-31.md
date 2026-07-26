# Scheduled Run Report — 2026-05-31 (Monday Entry, Sunday-Eve Refresh)

**Task:** `update-stock-data-and-generate-trades`
**Run:** 2026-06-01 02:09–02:11 UTC (= Sun 2026-05-31 ~22:09 ET, automated)
**Target basket:** Monday 2026-06-01 entry / Friday 2026-06-05 expiry

---

## TL;DR

- **Fresh Yahoo pull on Sunday-evening UTC.** Macro vs. last Sunday: SPY 739.17 → **756.48** (+2.3%), SPX 7,408.50 → **7,580.06** (+2.3%), VIX 18.43 → **15.32** (−16.9%, vol crushed), SKEW 145.77 → **144.18** (−1.1%), MOVE 79.87 → **70.22** (−12.1%). Risk-on tone across all four pillars.
- **GSRS = 2.58** (vs. 3.26 last Sun-eve). Crossed back into the **0–3 aggressive band** — default `$55k`/name sizing is within policy. SKEW remains the largest contributor (4.42) but every other component eased.
- **Basket (8 picks):** Calls — **RDW, QBTS, NVTS, POET.** Puts — **RCAT, U, UPST, RUN.** All earnings-clean for the 2026-06-01..2026-06-05 holding window.
- **Totals:** ~$65,176 credit / ~$439,726 margin → **~14.8% weekly credit/margin** (basket-level).
- **TradingView download skipped** — same `rookiepy` browser-cookie limitation as the prior seven runs.
- **Python `polytheta-yahoo-downloader` skipped** — same macOS-built Python 3.11 `.venv` issue; sandbox has Python 3.10 only. Node `yahoo-finance2` pipeline covers the same Yahoo dataset for basket purposes.
- **No orders placed.**

---

## What ran

| Step | Script | Result |
|---|---|---|
| 1. Macro quotes + SPY/SPX/VIX history | `node scripts/_run_weekly_refresh_2026_05_11.mjs 2026-06-01 2026-06-05` (step 1) | 18 macro tickers, 122–128 history bars |
| 2. Universe quotes (CBOE weeklys) | same runner, step 2 | 677 / 679 tickers (0 errors), 201 in $8–$40 band |
| 3. Option chains + IV summary | `node scripts/_chains_parallel.mjs 2026-06-01` | 201 / 201 tickers (0 errors), expiry 2026-06-05 |
| 4. Shortlist + refine | `node scripts/_run_filter_refine_2026_04_27.mjs 2026-06-01` | 97 calls / 67 puts refined |
| 5. Earnings dates fetch | `node scripts/_fetch_earnings_dates_2026_05_11.mjs 2026-06-01 2026-06-05` | 102 tickers; 6 with earnings 6/01–6/05 |
| 6. Earnings filter + rerank | `node scripts/_filter_earnings_and_rank.mjs 2026-06-01 2026-06-01 2026-06-05` | 92 calls / 61 puts surviving |
| 7. Basket proposal | `node scripts/_build_basket_2026_06_01_monday.mjs` (new this week) | 4 calls + 4 puts |

New code this run: `scripts/_build_basket_2026_06_01_monday.mjs` — clone of last week's builder with curated 2026-06-05 picks. Hard earnings filter applied to candidate list.

## Macro snapshot (Friday 2026-05-29 close, fetched 2026-06-01 02:09 UTC)

| Metric | Value | vs prior Sun-eve (2026-05-18) |
|---|---|---|
| SPY | 756.48 | +17.31 (+2.34%) |
| SPX | 7,580.06 | +171.56 (+2.32%) |
| VIX | 15.32 | −3.11 (−16.9%) |
| VIX prev close | 15.74 | −1.52 |
| VIX 1d change | **−0.42** | gentle pullback into the weekend |
| SKEW | **144.18** | −1.59 (−1.1%) |
| MOVE | **70.22** | −9.65 (−12.1%) |
| HY OAS | 2.86% (carried — TV refresh skipped) | unchanged |

**GSRS components**: VIX 1.33, SKEW 4.42, HY OAS 3.25, MOVE 2.02, P/C 3.15
**GSRS = 2.58** (last Sun: 3.26). Back inside the 0–3 aggressive band. Drivers: VIX component −1.36 (the biggest swing), MOVE component −0.97, SKEW component −0.16.

**Suggested sizing posture:** GSRS 2.58 supports the default `$55k`/name allocation and full double-down protocol. No regime-driven trim required at the open.

## Names excluded for earnings during 2026-06-01 → 2026-06-05

Pulled fresh from `quoteSummary.calendarEvents`. **6 names blocked**:

- **Mon 6/01:** REPL
- **Tue 6/02:** GTLB
- **Wed 6/03:** AI, M, UEC
- **Thu 6/04:** IOT

Note: REPL, GTLB, AI, M, and IOT were all top-25 put-side candidates by composite score — the earnings filter removed real liquidity. UEC was a refined call-side candidate. None of the picks below carry earnings exposure inside the window.

## Earnings-date caveat — RCAT and similar

RCAT's Yahoo `calendarEvents` returns `2026-05-07` as the next earnings date — that date has already passed. Per the trailing quarterly cadence, RCAT's next earnings is expected ~early August, so the position is unlikely to face an earnings event in the 6/01–6/05 window. Same caveat applies to a handful of others not in the basket (BTDR 5/14, CSIQ 5/14, CORZ 5/06, FCEL 6/08 — note FCEL date is *after* basket expiry so the filter let it through, but it would be a concern for next week's basket).

## Final earnings-clean basket (8 names)

### Call side (sell OTM calls)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RDW  | 24.57 | 30 C | 0.60 | 0.70 | 0.650 | 0.19 | 2.55 | 2.13× | 195% | 76 | 8/05 | 151 | $55,115 |
| QBTS | 30.14 | 35 C | 0.73 | 0.80 | 0.765 | 0.21 | 2.89 | 1.68× | 163% | 87 | 8/06 | 129 | $55,019 |
| NVTS | 26.60 | 31 C | 0.57 | 0.74 | 0.655 | 0.21 | 3.42 | 1.29× | 163% | 86 | 8/03 | 146 | $54,823 |
| POET | 12.29 | 15 C | 0.28 | 0.32 | 0.300 | 0.18 | 2.46 | 1.10× | 189% | 58 | 8/11 | 306 | $55,080 |

Call subtotal: ~$220,037 margin, ~$38,427 credit (mid).

### Put side (sell OTM puts)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RCAT | 14.50 | 12.5 P | 0.22 | 0.31 | 0.265 | −0.15 | 1.22 | 1.64× | 151% | 76 | 5/07* | 363 | $54,995 |
| U    | 30.47 | 28.5 P | 0.37 | 0.44 | 0.405 | −0.20 | 1.61 | 1.22× |  82% |  9 | 8/05 | 121 | $54,801 |
| UPST | 33.79 | 31.5 P | 0.45 | 0.50 | 0.475 | −0.20 | 1.90 | 1.21× |  86% | 44 | 8/04 | 111 | $54,867 |
| RUN  | 16.72 | 15 P   | 0.20 | 0.27 | 0.235 | −0.16 | 0.91 | 1.89× | 112% |  5 | 8/05 | 296 | $55,026 |

\* RCAT date is the prior earnings — see caveat above. No forward date in Yahoo `calendarEvents`.

Put subtotal: ~$219,689 margin, ~$26,749 credit (mid).

**Combined: ~$439,726 margin, ~$65,176 credit at mid (≈ 14.8% weekly credit/margin).**

With 4× portfolio margin, cash required ≈ **$109,932** (= $439,726 / 4).

## Liquidity & spread flags

- **RDW 30 C** — 14% spread (0.60 / 0.70), **1,432 vol / 1,024 OI**. Best mix of liquidity and spread on the call side; should fill at or near mid.
- **QBTS 35 C** — **9% spread** (0.73 / 0.80), 2,446 vol / 2,576 OI. Tightest spread of any pick.
- **NVTS 31 C** — 23% spread (0.57 / 0.74), 1,281 vol / 649 OI. Work the limit closer to bid (~$0.62).
- **POET 15 C** — 13% spread (0.28 / 0.32), 2,102 vol / 3,846 OI. Easy fill. Thin 1.10× ATR buffer is the basket's main risk flag — high-IV name, watch the daily ATR if POET runs.
- **RCAT 12.5 P** — 29% spread (0.22 / 0.31), 346 vol / 750 OI. Acceptable.
- **U 28.5 P** — 16% spread (0.37 / 0.44), 116 vol / 93 OI. Easy fill.
- **UPST 31.5 P** — **10% spread** (0.45 / 0.50), 22 vol / 23 OI. Tightest put-side spread, but volume is light — bid may move on order.
- **RUN 15 P** — 30% spread (0.20 / 0.27), 46 vol / 221 OI. Work the limit close to bid (~$0.22).

## Differences vs. last Sunday's basket (2026-05-26 Tuesday entry)

- **Macro regime:** GSRS 3.26 → 2.58 — back inside the 0–3 aggressive band. Vol-of-vol collapsed across VIX and MOVE; SKEW held high.
- **Earnings window:** 0 names blocked last week (short Memorial Day week) vs. 6 this week — six top-25 candidates filtered out (REPL/GTLB/AI/M/UEC/IOT).
- **Picks:** completely fresh — no overlap with last week's basket (NVTS, RGTI, LUNR, POET / SOC, BTDR, DOW, CCL). POET carries over but on the call side at the same strike. NVTS carries over but at K=31 (vs. K=36 last week — the underlying gave back ~$10).
- **Sector spread:** Calls = space / quantum / power-semi / photonics. Puts = drones-defense / gaming-SaaS / fintech-AI-lending / solar. No single sector has more than one position.

## Files written / updated this run

`baskets/2026-06-01/data/`:
- `macro_quotes.csv` — fresh 02:09 UTC (18 tickers)
- `SPY_history.csv`, `GSPC_history.csv`, `VIX_history.csv` — fresh 02:09 UTC (122–128 bars)
- `weeklys_universe.csv` — copied from `baskets/2026-05-26/data/` (682 rows, same CBOE weeklys universe — no fresh Cboe pull)
- `universe_quotes.csv` — fresh 02:09 UTC (677 rows, 0 errors)
- `universe_8to40.csv` — fresh 02:09 UTC (201 rows)
- `chains_2026-06-05_v2.csv` — fresh 02:10 UTC (201 tickers, 0 errors)
- `chain_summary_v2.csv` — fresh 02:10 UTC (201 rows)
- `shortlist_calls.csv`, `shortlist_calls_refined.csv` — fresh 02:10 UTC
- `shortlist_puts.csv`, `shortlist_puts_refined.csv` — fresh 02:10 UTC
- `earnings_dates.json` — fresh 02:10 UTC (102 tickers, 6 in window)
- `shortlist_calls_no_earnings.csv` — fresh 02:10 UTC (92 rows)
- `shortlist_puts_no_earnings.csv` — fresh 02:10 UTC (61 rows)
- `basket_proposal.json` — fresh 02:11 UTC (8 picks, totals, GSRS, macro)
- `refresh_manifest.json` — fresh 02:09 UTC

`scripts/`:
- `_build_basket_2026_06_01_monday.mjs` — new this week. Clone of `_build_basket_2026_05_26.mjs` with curated 2026-06-05 picks. Hard earnings filter applied to candidate list.

## What didn't run

- **TradingView downloader** — `rookiepy` requires access to the user's local Edge/Chrome cookie jar to authenticate against TradingView. The Linux sandbox can't see the user's macOS browser keychain, so the Python downloader bails before touching the screener. **Seventh consecutive run with this skip** — recommend running locally on the Mac to refresh `data_trading_view/`. Most recent TV snapshot remains `data_trading_view/2026-04-19 21-50-16_tradingview_weeklys.csv`.
- **`polytheta-yahoo-downloader` Python CLI** — `python/yahoo_equity_downloader/.venv/pyvenv.cfg` points at `/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11`; the sandbox has Python 3.10 only. The pyproject is pinned `requires-python = ">=3.11"`. Recommend a local rebuild of the venv with `python3.11 -m venv …; pip install -e ./python/yahoo_equity_downloader` so the cron entry can run end-to-end on the host. The Node pipeline covers the same Yahoo dataset for basket purposes; the Python downloader's auxiliary signal exports (FTD, short interest, SEC filings, signal_snapshots, macro extras like HY OAS, P/C) have not been refreshed since the last successful Mac-host run.
- **Weeklys universe Cboe pull** — the prior basket's `weeklys_universe.csv` (682 rows) was reused. If a name was added/removed by Cboe over the week, the basket may miss it.

## Next-Monday checklist (operator)

1. Open `baskets/2026-06-01/data/basket_proposal.json` and review the 8 picks against current quotes at the open.
2. **Sizing:** GSRS 2.58 supports the default `$55k`/name allocation. No regime-driven trim needed.
3. **POET 15 C** carries the basket's thinnest ATR buffer (1.10×). If POET rallies on photonics-sector news, consider exiting or rolling early.
4. **RCAT earnings caveat:** Yahoo shows last earnings date (5/07). Verify no forward date inside 6/01–6/05 before entering the position.
5. **NVTS 31 C, RUN 15 P, RCAT 12.5 P** have 23–30% spreads — work limit orders closer to bid rather than mid for better fills.
6. Re-verify the full earnings calendar one more time at the open — Yahoo can update over Sunday → Monday. The 6-name block list is current as of 2026-06-01 02:10 UTC.
7. Confirm GSRS still in the 0–3 band Monday morning before final sizing (VIX gap risk in either direction).
8. Place trades manually — Claude does not execute orders.

## Notes

- All file timestamps are UTC.
- Today (2026-05-31) is Sunday. Monday 2026-06-01 is a standard market session (no holiday).
