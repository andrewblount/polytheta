# Scheduled Run Report — 2026-05-11 (Monday Entry, Friday Refresh)

**Task:** `update-stock-data-and-generate-trades`
**Run:** 2026-05-08 21:09–21:15 UTC (automated, Friday close)
**Target basket:** Monday 2026-05-11 entry / Friday 2026-05-15 expiry

---

## TL;DR

- Yahoo-side data refreshed end-to-end: macro, history, universe quotes, option chains, IV summary, refined shortlists, earnings dates, no-earnings shortlists, basket proposal.
- **Earnings-heavy week again**: 31 of 88 refined-shortlist tickers report between 2026-05-11 and 2026-05-15. Many of the highest-IV names this run (EOSE, POET, BTDR, RUM, HIMS, SGML, FIG, KLAR, FIGR, RGTI, QUBT, CSIQ, LUNR, USAR, UMAC, ASST, NNE, ONDS, MARA, ONON, AG, MOS) are blocked.
- **Final basket**: **FLY, NVTS, FCEL, SMCI** (calls) + **RIOT, WRBY, IBRX, CCL** (puts). All 8 are earnings-clean for the holding window.
- Total credit ~$57,562 against ~$440,102 margin → **~13.1% weekly credit/margin** (vs. 14.6% last week). The slightly lower ratio reflects no name above buf=2× this week.
- Macro slipped slightly riskier vs. last Friday: SPY/SPX +2.4%, VIX 17.19 (essentially flat at 17.08→17.19), MOVE down 70.41→67.25, SKEW down 143.33→136.11. **GSRS = 2.60** (still in the 0–3 aggressive band, full 5% sizing both sides, doubles enabled).
- **TradingView download skipped** — same `rookiepy` browser-cookie limitation in the Linux sandbox as the prior three runs. Most recent TradingView snapshot remains `data_trading_view/2026-04-19 21-50-16_tradingview_weeklys.csv`.
- **Python `polytheta-yahoo-downloader` skipped** — same macOS-built `.venv` (Python 3.11 path) issue; the sandbox has only Python 3.10. The Node-based `run_weekly_refresh.mjs` + `_chains_parallel.mjs` pipeline pulls the same Yahoo data and is what populated `baskets/2026-05-11/data/`.
- **No orders placed.**

---

## What ran

| Step | Script | Result |
|---|---|---|
| 1. Macro quotes + SPY/SPX/VIX history | `scripts/_run_weekly_refresh_2026_05_11.mjs` (step 1; auto-derived `basket_date=2026-05-11`, `expiry=2026-05-15`) | 18 macro tickers, 124–130 bars each |
| 2. Universe quotes (CBOE weeklys) | `scripts/_chunked_universe_quotes_2026_05_11.mjs` (resumable; sandbox bash 45 s cap forces chunking) | 678 / 679 tickers (0 errors), 201 in $8–$40 band |
| 3. Option chains + IV summary | `scripts/_chains_parallel.mjs 2026-05-11` | 201 / 201 tickers (0 errors) |
| 4. Shortlist + refine | `scripts/_run_filter_refine_2026_04_27.mjs 2026-05-11` | 81 call candidates / 72 put candidates |
| 5. Earnings dates fetch | `scripts/_fetch_earnings_dates_2026_05_11.mjs 2026-05-11 2026-05-15` (NEW; clone of the 5/04 helper) | 88 tickers, 31 with earnings 5/11–5/15 |
| 6. Earnings filter + rerank | `scripts/_filter_earnings_and_rank.mjs 2026-05-11 2026-05-11 2026-05-15` | 51 calls / 43 puts surviving |
| 7. Basket proposal | `scripts/_build_basket_2026_05_11_monday.mjs` (NEW; hard earnings filter) | 4 calls + 4 puts |

The `run_weekly_refresh.mjs` step-3 path still times out on the sandbox's 45-second per-call limit, so chains were fetched in `_chains_parallel.mjs`. Universe-quote step also exceeds the per-call budget, so a chunked resumable variant was added (`_chunked_universe_quotes_2026_05_11.mjs`) that persists progress between batches.

## Macro snapshot (Friday 2026-05-08 close)

| Metric | Value | vs 2026-05-01 (last refresh) |
|---|---|---|
| SPY | 737.62 | +16.97 (+2.36%) |
| SPX | 7,398.93 | +168.81 (+2.34%) |
| VIX | 17.19 | +0.20 (essentially flat) |
| VIX prev close | 17.08 | — (1-day Δ: +0.11) |
| SKEW | 136.11 | −7.22 |
| MOVE | 67.25 | −3.16 |
| HY OAS | 2.86% (carried — TV refresh skipped) | — |
| OVX | 72.15 | n/a (new in macro pull) |

**GSRS components**: VIX 1.85, SKEW 3.61, HY OAS 3.25, MOVE 1.73, P/C 3.15
**GSRS = 2.60** → 0–3 band: full aggressive 5% sizing both sides; doubles enabled. Vol metrics softened across the board (VIX flat, SKEW −7, MOVE −3) and the index is at fresh highs — risk regime continues to lean toward selling premium with full size.

## Names excluded for earnings during 2026-05-11 → 2026-05-15

Pulled from `quoteSummary.calendarEvents` for all 88 refined candidates. **31 names blocked**:

**Mon 5/11:** BW, CLSK, FIGR, HIMS, MARA, MOS, PBR, QUBT, RGTI
**Tue 5/12:** AG, JD, ONON, QBTS, VG
**Wed 5/13:** EOSE, USAR
**Thu 5/14:** ASST, BTDR, CSIQ, FIG, KLAR, LUNR, NN, NNE, NU, ONDS, POET, RUM, UAMY, UMAC
**Fri 5/15:** SGML

This wave wipes out most of the highest-IV names in the screener — every name with IV > 130% on the call side this week is an earnings name. The selection had to come from the second tier of IV richness, which is why no pick this run cleared 2× ATR buffer.

## Final earnings-clean basket (8 names)

### Call side (sell OTM calls)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FLY  | 39.68 | 46 C  | 0.50 | 1.10 | 0.80  | 0.18 | 4.09 | 1.55× | 117% | 79 | 8/04 | 102 | $55,080 |
| NVTS | 18.20 | 22 C  | 0.50 | 0.51 | 0.505 | 0.20 | 2.37 | 1.60× | 153% | 31 | 8/03 | 203 | $54,912 |
| FCEL | 13.70 | 17 C  | 0.20 | 0.30 | 0.25  | 0.14 | 1.73 | 1.90× | 141% | 98 | 6/05 | 282 | $54,990 |
| SMCI | 35.37 | 39 C  | 0.47 | 0.54 | 0.505 | 0.19 | 2.24 | 1.62× | 80%  | 49 | 8/04 | 125 | $55,063 |

Call subtotal: ~$220,045 margin, ~$31,775 credit (mid).

### Put side (sell OTM puts)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RIOT | 24.08 | 22 P    | 0.31 | 0.37 | 0.34  | −0.17 | 1.46 | 1.43× | 79%  | 53 | 7/30 | 179 | $55,060 |
| WRBY | 29.55 | 27 P    | 0.30 | 0.45 | 0.375 | −0.16 | 1.93 | 1.32× | 76%  | 79 | 8/06 | 147 | $54,904 |
| IBRX |  8.51 |  7.5 P  | 0.15 | 0.20 | 0.175 | −0.17 | 0.56 | 1.79× | 113% | 31 | 8/04 | 595 | $55,038 |
| CCL  | 26.38 | 24.5 P  | 0.22 | 0.28 | 0.25  | −0.16 | 1.17 | 1.61× | 59%  | 65 | 6/24 | 151 | $55,055 |

Put subtotal: ~$220,057 margin, ~$25,787 credit (mid).

**Combined: ~$440,102 margin, ~$57,562 credit at mid (≈ 13.1% weekly credit/margin).**

### Buffer flags
- **No name clears the 2× ATR target this week.** The high-IV names that would have given 2.5–3× (EOSE, BTDR, RUM, HIMS, SGML, etc.) are all earnings-blocked. The basket is back to the same dynamic seen on 2026-05-04: sub-target buffers as the trade-off for earnings cleanliness.
- **WRBY 1.32×** is the lowest call-side buffer; FCEL 1.90× is the deepest. **IBRX 1.79×** is the best put-side buffer.
- All eight names sit within 1.32×–1.90×, a tighter band than 5/04's range. Acceptable with GSRS in the 0–3 band but worth monitoring.

### Liquidity / spread flags
- **FLY 46 C bid/ask 0.50/1.10** — ~75% spread on a thin contract (vol 27, OI 62). Mid 0.80 is optimistic; expect to work the limit closer to 0.60. If unable to fill at 0.65+, FLY 45 C (closer-to-money, deeper book) or sub the name out for **CRML 15 C** (12.53 px, IV 125%, buf 1.60×, but earnings 2025-03-19 long past).
- **WRBY 27 P bid/ask 0.30/0.45** — OI just 13 contracts, vol 15 today. Spread is workable (~30%) but exit liquidity is the concern. Consider half-sizing or substituting **GTLB 24 P** (25.98 px, IV 65%, buf 1.49×, earnings already past — 2026-03-03 → next is 2026-08+).
- **NVTS 22 C bid 0.50/ask 0.51, vol 362, OI 439** — tight spread, decent depth. Clean fill expected.
- **SMCI 39 C** — tight spread (0.47/0.54), vol 835, OI 3,127. Best liquidity on the call side.
- **IBRX 7.5 P** — tight spread (0.15/0.20), OI 14,729 (deepest book in the basket), vol 243. Excellent liquidity.
- **RIOT 22 P** — tight spread (0.31/0.37), vol 1,483, OI 1,520. Strong fill.
- **CCL 24.5 P** — tight spread (0.22/0.28), vol 281, OI 789. Decent.

### Sector composition
- **Calls**: FLY (aerospace/space-launch), NVTS (power semis), FCEL (clean energy / fuel cells), SMCI (AI/server hardware). All four different sectors.
- **Puts**: RIOT (BTC mining), WRBY (retail/eyewear), IBRX (biotech), CCL (cruise/leisure). All four different sectors.
- **No call/put overlap** by ticker or by direct sector. Closest is RIOT/SMCI both being AI-power-narrative-adjacent in market structure, but their fundamentals/sectors are distinct and sit on opposite sides of the basket so they don't compound directional exposure.

### Sizing reasonableness
- 4 names × $55K margin per side ≈ $220K each side ≈ $440K total margin. Matches last week's `NAME_BUDGET = 55000` assumption in the build script. With GSRS = 2.60 in the 0–3 aggressive band, full 5% per-name sizing is enabled both sides.

## What didn't run

- **TradingView downloader** — `rookiepy` requires access to the user's local Edge/Chrome cookie jar to authenticate against TradingView. The Linux sandbox can't see the user's macOS browser keychain, so the Python downloader bails before touching the screener. Fourth consecutive run with this skip — recommend running locally on the Mac to refresh `data_trading_view/`.
- **`polytheta-yahoo-downloader` Python CLI** — `python/yahoo_equity_downloader/.venv` was built on macOS pointing at `/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11`; the sandbox has Python 3.10 only and can't run that interpreter. The pyproject is pinned `requires-python = ">=3.11"`. The Node pipeline (`run_weekly_refresh.mjs` + `_chains_parallel.mjs`) covers the same Yahoo dataset for basket-generation purposes; the Python downloader's extras (signal_snapshots, macro_signals, filing_signals, short_interest, social, FTD, provider_status) were not refreshed. Recommend a local rebuild of the venv with `python3.11 -m venv …; pip install -e ./python/yahoo_equity_downloader` so the cron entry can run end-to-end on the host.

## Files written / updated

`baskets/2026-05-11/data/`:
- `macro_quotes.csv` — fresh 21:10 UTC (18 tickers including SPY, ^GSPC, ^VIX, ^SKEW, ^MOVE, ^OVX)
- `SPY_history.csv`, `GSPC_history.csv`, `VIX_history.csv` — fresh 21:10 UTC (124–130 bars each)
- `universe_quotes.csv` — fresh 21:12 UTC (678 rows, 1 dropped)
- `universe_8to40.csv` — fresh 21:12 UTC (201 rows)
- `chains_2026-05-15_v2.csv` — fresh 21:12 UTC (~838 KB, 0 errors)
- `chain_summary_v2.csv` — fresh 21:12 UTC (201 rows)
- `shortlist_calls.csv`, `shortlist_calls_refined.csv` — fresh 21:13 UTC (105 / 80 rows)
- `shortlist_puts.csv`, `shortlist_puts_refined.csv` — fresh 21:13 UTC (107 / 71 rows)
- `earnings_dates.json` — fresh 21:13 UTC (88 tickers, 31 in window)
- `shortlist_calls_no_earnings.csv` — fresh 21:13 UTC (51 rows)
- `shortlist_puts_no_earnings.csv` — fresh 21:13 UTC (43 rows)
- `basket_proposal.json` — fresh 21:15 UTC (8 picks, totals, GSRS, macro)

`scripts/`:
- `_run_weekly_refresh_2026_05_11.mjs` — patched copy of `run_weekly_refresh.mjs` that skips step 3 (chains run separately to avoid sandbox timeouts).
- `_chunked_universe_quotes_2026_05_11.mjs` — NEW. Resumable universe-quote fetcher that persists progress between batches so it fits in 45 s sandbox windows.
- `_fetch_earnings_dates_2026_05_11.mjs` — NEW. Holding window pinned to 2026-05-11..2026-05-15.
- `_build_basket_2026_05_11_monday.mjs` — NEW. Curated picks for this week with hard earnings filter.

`weeklys_universe.csv` carried over from 2026-05-04 (681-symbol Cboe weeklys list; no fresh Cboe pull this run because the Python `polytheta-yahoo-downloader` step was skipped).

## Next-Monday checklist (operator)

1. Open `baskets/2026-05-11/data/basket_proposal.json` and review the 8 picks against current quotes.
2. Confirm none of the eight have post-Friday earnings reschedules (Yahoo's calendar can update over the weekend). The 31-name block list above is a lower bound — re-verify Monday morning.
3. **FLY 46 C** and **WRBY 27 P** are flagged for liquidity. Either work the limit aggressively close to bid, or substitute (CRML for FLY, GTLB for WRBY).
4. Confirm GSRS = 2.60 still holds Monday morning before sizing (VIX gap-up risk).
5. Place trades manually — Claude does not execute orders.

## Notes

- This is the fourth consecutive run with the Python `polytheta-yahoo-downloader` and TradingView downloaders skipped. The Node fallback pipeline is fully sufficient for basket generation but the Python downloader's auxiliary signal exports (FTD, short interest, SEC filings, etc.) have not been refreshed since the last successful Mac-host run.
- All file timestamps are UTC.
