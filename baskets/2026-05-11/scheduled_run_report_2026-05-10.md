# Scheduled Run Report — 2026-05-11 (Monday Entry, Sunday-Eve Refresh)

**Task:** `update-stock-data-and-generate-trades`
**Run:** 2026-05-11 02:10–02:13 UTC (= Sun 2026-05-10 ~22:10 ET, automated)
**Target basket:** Monday 2026-05-11 entry / Friday 2026-05-15 expiry

---

## TL;DR

- This is a **re-run on top of the Friday 2026-05-08 close data**. Markets were closed all weekend, so the underlying tape is unchanged from the prior `scheduled_run_report_2026-05-08.md`. Re-pulling Yahoo on Sun-eve confirmed the macro snapshot is identical to Friday's close (SPY 737.62, SPX 7,398.93, VIX 17.19, MOVE 67.25), with one minor over-the-weekend revision: **SKEW ticked from 136.11 → 138.21** (Yahoo back-filled an updated print).
- **Basket is unchanged** vs. the Friday proposal: **FLY, NVTS, FCEL, SMCI** (calls) + **RIOT, WRBY, IBRX, CCL** (puts). All eight clear earnings 2026-05-11..2026-05-15.
- **GSRS = 2.64** (vs. 2.60 Friday). The 0.04 nudge is entirely the SKEW component (3.61 → 3.82); still firmly in the 0–3 aggressive band → full 5% per-name sizing both sides, doubles enabled.
- Totals: ~$57,562 credit / ~$440,102 margin → **~13.1% weekly credit/margin**, identical to Friday's calc.
- **TradingView download skipped** — same `rookiepy` browser-cookie limitation as the prior four runs (sandbox can't see the user's macOS browser keychain). Most recent TV snapshot remains `data_trading_view/2026-04-19 21-50-16_tradingview_weeklys.csv`.
- **Python `polytheta-yahoo-downloader` skipped** — same macOS-built `.venv` (Python 3.11 path) issue; sandbox has Python 3.10 only and the pyproject pins `requires-python = ">=3.11"`. The Node pipeline (`run_weekly_refresh.mjs` + `_chains_parallel.mjs`) covers the same Yahoo dataset for basket-generation purposes.
- **No orders placed.**

---

## What ran

| Step | Script | Result |
|---|---|---|
| 1. Macro quotes + SPY/SPX/VIX history | `scripts/_run_weekly_refresh_2026_05_11.mjs 2026-05-11 2026-05-15` (step 1 only; step 3 chains run separately to fit the 45 s sandbox cap) | 18 macro tickers, 122–128 history bars |
| 2. Universe quotes (CBOE weeklys) | same runner, step 2 | 678 / 679 tickers (0 errors), 201 in $8–$40 band |
| 3. Option chains + IV summary | `scripts/_chains_parallel.mjs 2026-05-11` | 201 / 201 tickers (0 errors), expiry 2026-05-15 |
| 4. Shortlist + refine | `scripts/_run_filter_refine_2026_04_27.mjs 2026-05-11` | 105 call candidates / 107 put candidates → 80 / 71 refined |
| 5. Earnings dates fetch | `scripts/_fetch_earnings_dates_2026_05_11.mjs 2026-05-11 2026-05-15` | 88 tickers; 31 with earnings 5/11–5/15 |
| 6. Earnings filter + rerank | `scripts/_filter_earnings_and_rank.mjs 2026-05-11 2026-05-11 2026-05-15` | 51 calls / 43 puts surviving |
| 7. Basket proposal | `scripts/_build_basket_2026_05_11_monday.mjs` | 4 calls + 4 puts |

Code change this run: added optional CLI overrides to `_run_weekly_refresh_2026_05_11.mjs` so it can target a basket date / expiry that don't match its `nextMonday()` derivation. This was needed because the run fired after 00:00 UTC, by which point `nextMonday(today)` returns 2026-05-18 instead of 2026-05-11. With the override, the runner correctly writes to `baskets/2026-05-11/data/`.

## Macro snapshot (Friday 2026-05-08 close, fetched 2026-05-11 02:11 UTC)

| Metric | Value | vs 2026-05-08 (prior run) |
|---|---|---|
| SPY | 737.62 | 0 (unchanged — market closed) |
| SPX | 7,398.93 | 0 |
| VIX | 17.19 | 0 |
| VIX prev close | 17.08 | 0 |
| SKEW | **138.21** | **+2.10** (Yahoo back-fill over the weekend) |
| MOVE | 67.25 | 0 |
| HY OAS | 2.86% (carried — TV refresh skipped) | 0 |

**GSRS components**: VIX 1.85, SKEW 3.82, HY OAS 3.25, MOVE 1.73, P/C 3.15
**GSRS = 2.64** (Friday: 2.60). Still solidly in 0–3 aggressive regime: 5% per-name sizing both sides, doubles enabled. The SKEW back-fill is the only real change vs. Friday's read; everything else is identical.

## Names excluded for earnings during 2026-05-11 → 2026-05-15

Pulled fresh from `quoteSummary.calendarEvents`. **31 names blocked** (same set as Friday plus LI and XPEV which now show calendar entries inside the window):

**Mon 5/11:** BW, CLSK, FIGR, HIMS, MARA, MOS, PBR, QUBT, RGTI
**Tue 5/12:** AG, JD, ONON, QBTS, VG
**Wed 5/13:** USAR
**Thu 5/14:** ASST, BTDR, CSIQ, EOSE, FIG, KLAR, LI, LUNR, NN, NNE, NU, ONDS, RUM, UAMY, UMAC
**Fri 5/15:** SGML, XPEV

(EOSE earnings appears earlier in the calendar pull this run; LI / XPEV moved into the window.)

## Final earnings-clean basket (8 names) — unchanged from Friday

### Call side (sell OTM calls)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FLY  | 39.68 | 46 C  | 0.50 | 1.10 | 0.80  | 0.19 | 4.09 | 1.55× | 148% | 79 | 8/04 | 102 | $55,080 |
| NVTS | 18.20 | 22 C  | 0.50 | 0.51 | 0.505 | 0.20 | 2.37 | 1.60× | 193% | 31 | 8/03 | 203 | $54,912 |
| FCEL | 13.70 | 17 C  | 0.20 | 0.30 | 0.25  | 0.14 | 1.73 | 1.90× | 141% | 98 | 6/05 | 282 | $54,990 |
| SMCI | 35.37 | 39 C  | 0.47 | 0.54 | 0.505 | 0.19 | 2.24 | 1.62× |  80% | 49 | 8/04 | 125 | $55,063 |

Call subtotal: ~$220,045 margin, ~$31,775 credit (mid).

### Put side (sell OTM puts)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RIOT | 24.08 | 22 P    | 0.31 | 0.37 | 0.34  | −0.18 | 1.46 | 1.43× |  79% | 53 | 7/30 | 179 | $55,060 |
| WRBY | 29.55 | 27 P    | 0.30 | 0.45 | 0.375 | −0.17 | 1.93 | 1.32× |  76% | 79 | 8/06 | 147 | $54,904 |
| IBRX |  8.51 |  7.5 P  | 0.15 | 0.20 | 0.175 | −0.18 | 0.56 | 1.79× | 113% | 31 | 8/04 | 595 | $55,038 |
| CCL  | 26.38 | 24.5 P  | 0.22 | 0.28 | 0.25  | −0.16 | 1.17 | 1.61× |  59% | 65 | 6/24 | 151 | $55,055 |

Put subtotal: ~$220,057 margin, ~$25,787 credit (mid).

**Combined: ~$440,102 margin, ~$57,562 credit at mid (≈ 13.1% weekly credit/margin).**

## Differences vs. Friday's report

- **Macro:** SKEW 136.11 → 138.21 (back-filled). Everything else identical.
- **GSRS:** 2.60 → 2.64. Same regime, same sizing rule.
- **Earnings list:** EOSE moved from Wed 5/13 to Thu 5/14. LI and XPEV newly inside the window. None of these names were in the basket, so the basket is unaffected.
- **Picks:** identical — FLY, NVTS, FCEL, SMCI / RIOT, WRBY, IBRX, CCL.
- **Liquidity / spread flags:** unchanged. FLY 46 C and WRBY 27 P remain the two thinly-traded contracts to watch (substitutes: CRML 15 C for FLY, GTLB 24 P for WRBY).

## Files written / updated this run

`baskets/2026-05-11/data/`:
- `macro_quotes.csv` — fresh 02:11 UTC (18 tickers)
- `SPY_history.csv`, `GSPC_history.csv`, `VIX_history.csv` — fresh 02:11 UTC (122–128 bars)
- `universe_quotes.csv` — fresh 02:11 UTC (678 rows)
- `universe_8to40.csv` — fresh 02:11 UTC (201 rows)
- `chains_2026-05-15_v2.csv` — fresh 02:12 UTC (201 tickers, 0 errors)
- `chain_summary_v2.csv` — fresh 02:12 UTC (201 rows)
- `shortlist_calls.csv`, `shortlist_calls_refined.csv` — fresh 02:12 UTC (105 / 80 rows)
- `shortlist_puts.csv`, `shortlist_puts_refined.csv` — fresh 02:12 UTC (107 / 71 rows)
- `earnings_dates.json` — fresh 02:12 UTC (88 tickers, 31 in window)
- `shortlist_calls_no_earnings.csv` — fresh 02:12 UTC (51 rows)
- `shortlist_puts_no_earnings.csv` — fresh 02:12 UTC (43 rows)
- `basket_proposal.json` — fresh 02:12 UTC (8 picks, totals, GSRS, macro)
- `refresh_manifest.json` — fresh 02:11 UTC

`scripts/`:
- `_run_weekly_refresh_2026_05_11.mjs` — added optional `[basket_date] [expiry_iso]` CLI overrides so the runner can target a basket date that doesn't match `nextMonday(today)`. Backwards-compatible; with no args it falls back to the original derivation.

`baskets/2026-05-18/data/` — incidentally created by the first invocation before the CLI override was added (stub macro pull only — no chains, no shortlists, no basket). Files are read-only and could not be removed from the sandbox; can be manually deleted on the host. Not a real run.

## What didn't run

- **TradingView downloader** — `rookiepy` requires access to the user's local Edge/Chrome cookie jar to authenticate against TradingView. The Linux sandbox can't see the user's macOS browser keychain, so the Python downloader bails before touching the screener. **Fifth consecutive run with this skip** — recommend running locally on the Mac to refresh `data_trading_view/`.
- **`polytheta-yahoo-downloader` Python CLI** — `python/yahoo_equity_downloader/.venv/pyvenv.cfg` points at `/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11`; the sandbox has Python 3.10 only. The pyproject is pinned `requires-python = ">=3.11"`. Recommend a local rebuild of the venv with `python3.11 -m venv …; pip install -e ./python/yahoo_equity_downloader` so the cron entry can run end-to-end on the host. The Node pipeline covers the same Yahoo dataset for basket purposes; the Python downloader's auxiliary signal exports (FTD, short interest, SEC filings, signal_snapshots, etc.) have not been refreshed since the last successful Mac-host run.

## Next-Monday checklist (operator)

1. Open `baskets/2026-05-11/data/basket_proposal.json` and review the 8 picks against current quotes at the open.
2. Re-verify earnings calendar one more time at the open — Yahoo can update over Sunday → Monday. The 31-name block list above is current as of 2026-05-11 02:12 UTC.
3. **FLY 46 C** and **WRBY 27 P** are flagged for liquidity. Either work the limit aggressively close to bid, or substitute (CRML 15 C for FLY, GTLB 24 P for WRBY).
4. Confirm GSRS = 2.64 still holds Monday morning before sizing (VIX gap-up risk).
5. Place trades manually — Claude does not execute orders.

## Notes

- All file timestamps are UTC.
- This is the fifth consecutive run with the Python `polytheta-yahoo-downloader` and TradingView downloaders skipped due to host-only dependencies. The Node fallback pipeline is fully sufficient for basket generation.
