# Scheduled Run Report — 2026-05-18 (Monday Entry, Sunday-Eve Refresh)

**Task:** `update-stock-data-and-generate-trades`
**Run:** 2026-05-18 02:10–02:14 UTC (= Sun 2026-05-17 ~22:10 ET, automated)
**Target basket:** Monday 2026-05-18 entry / Friday 2026-05-22 expiry

---

## TL;DR

- **Fresh Yahoo pull on Sunday-evening UTC.** Macro snapshot vs. last Sunday: SPY 737.62→**739.17** (+0.2%), SPX 7,398.93→**7,408.5** (+0.13%), VIX 17.19→**18.43** (+7.2%, 1.17 pt jump vs. prev close), SKEW 138.21→**145.77** (+5.5%), MOVE 67.25→**79.87** (+18.8%). Vol regime has firmed across all four pillars.
- **GSRS = 3.26** (vs. 2.64 last Sun-eve). Crossed above the 0–3 aggressive band into the **3–6 defensive band** — recommend trimming per-name sizing if you typically scale by regime; the script-computed sizing here uses the default ~$55k per name and may be richer than the policy calls for. SKEW component (4.58) is the largest contributor to the bump.
- **Basket (8 picks):** Calls — **NVTS, RDW, FIG, NNE.** Puts — **ASST, UPST, OUST, WULF.** All earnings-clean for the 2026-05-18..2026-05-22 holding window.
- **Totals:** ~$56,210 credit / ~$440,220 margin → **~12.8% weekly credit/margin**.
- **TradingView download skipped** — same `rookiepy` browser-cookie limitation as the prior five runs (sandbox can't see the user's macOS browser keychain).
- **Python `polytheta-yahoo-downloader` skipped** — same macOS-built `.venv` (Python 3.11 path) issue; sandbox has Python 3.10 only. The Node pipeline covers the same Yahoo dataset for basket purposes.
- **No orders placed.**

---

## What ran

| Step | Script | Result |
|---|---|---|
| 1. Macro quotes + SPY/SPX/VIX history | `node scripts/_run_weekly_refresh_2026_05_11.mjs 2026-05-18 2026-05-22` (step 1) | 18 macro tickers, 122–128 history bars |
| 2. Universe quotes (CBOE weeklys) | same runner, step 2 | 677 / 679 tickers (0 errors), 199 in $8–$40 band |
| 3. Option chains + IV summary | `node scripts/_chains_parallel.mjs 2026-05-18` | 197 / 199 tickers (2 errors: LUNR, PAA — Yahoo HTTP 400), expiry 2026-05-22 |
| 4. Shortlist + refine | `node scripts/_run_filter_refine_2026_04_27.mjs 2026-05-18` | 123 call candidates / 108 put candidates → 81 / 49 refined |
| 5. Earnings dates fetch | `node scripts/_fetch_earnings_dates_2026_05_11.mjs 2026-05-18 2026-05-22` | 86 tickers; 3 with earnings 5/18–5/22 |
| 6. Earnings filter + rerank | `node scripts/_filter_earnings_and_rank.mjs 2026-05-18 2026-05-18 2026-05-22` | 81 calls / 48 puts surviving |
| 7. Basket proposal | `node scripts/_build_basket_2026_05_18_monday.mjs` (new this week) | 4 calls + 4 puts |

New code this run: `scripts/_build_basket_2026_05_18_monday.mjs` — clone of last week's monday builder with curated picks for 2026-05-22 expiry.

## Macro snapshot (Friday 2026-05-15 close, fetched 2026-05-18 02:11 UTC)

| Metric | Value | vs prior Sun-eve (2026-05-11) |
|---|---|---|
| SPY | 739.17 | +1.55 (+0.21%) |
| SPX | 7,408.50 | +9.57 (+0.13%) |
| VIX | 18.43 | +1.24 (+7.2%) |
| VIX prev close | 17.26 | +0.18 |
| VIX 1d change | **+1.17** | sharp Friday close move |
| SKEW | **145.77** | +7.56 (+5.5%) |
| MOVE | **79.87** | +12.62 (+18.8%) |
| HY OAS | 2.86% (carried — TV refresh skipped) | unchanged |

**GSRS components**: VIX 2.69, SKEW 4.58, HY OAS 3.25, MOVE 2.99, P/C 3.15
**GSRS = 3.26** (last Sun: 2.64). Crossed out of 0–3 aggressive band into the 3–6 defensive band. Drivers: MOVE component nearly doubled (1.73→2.99) on the bond-vol jump; SKEW component +0.76; VIX component +0.84.

**Suggested sizing posture:** If your policy uses regime-tiered sizing, the basket-builder's default $55k per-name allocation may be too rich for a 3.26 GSRS. Consider scaling to ~70% of normal (~$38k per name) at the open, or skip the highest-vol names (NVTS, RDW, OUST) until VIX backs off.

## Names excluded for earnings during 2026-05-18 → 2026-05-22

Pulled fresh from `quoteSummary.calendarEvents`. **3 names blocked** (much quieter window than last week's 31):

- **Tue 5/19:** BILI
- **Wed 5/20:** VFC, ZIM

The 88-ticker universe-wide pull (over the refined shortlists) flagged only these three with confirmed earnings inside the holding window.

## Earnings-date caveat — OUST and similar

OUST's Yahoo `calendarEvents` returns `2026-05-05` as the next earnings date — that date has already passed (today is 5/17). This typically means Yahoo hasn't yet posted the Aug/quarterly forward-looking date for that name. Based on the trailing quarterly cadence, OUST's next earnings is expected ~early August, so the position is unlikely to face an earnings event in the 5/18–5/22 window — but operator should sanity-check at the open (companies sometimes announce mid-quarter). Same caveat applies to a handful of others in the refined list (CORZ, OSCR, SOC, etc.).

## Final earnings-clean basket (8 names)

### Call side (sell OTM calls)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| NVTS | 21.32 | 26 C   | 0.40 | 0.50 | 0.450 | 0.18 | 2.68 | 1.75× | 178% | 38 | 8/03 | 180 | $54,900 |
| RDW  | 14.06 | 16.5 C | 0.30 | 0.40 | 0.350 | 0.20 | 1.21 | 2.02× | 168% | 81 | 8/05 | 275 | $55,000 |
| FIG  | 22.92 | 26 C   | 0.28 | 0.32 | 0.300 | 0.16 | 1.42 | 2.17× | 114% | 32 | 8/14 | 190 | $55,100 |
| NNE  | 24.92 | 29 C   | 0.30 | 0.35 | 0.325 | 0.14 | 2.56 | 1.59× | 128% | 81 | 8/13 | 171 | $55,148 |

Call subtotal: ~$220,148 margin, ~$28,983 credit (mid).

### Put side (sell OTM puts)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ASST | 16.79 | 15 P   | 0.23 | 0.28 | 0.255 | −0.16 | 1.34 | 1.34× | 118% |  0 | 8/13 | 302 | $55,055 |
| UPST | 29.51 | 27 P   | 0.24 | 0.32 | 0.280 | −0.14 | 1.91 | 1.32× |  84% | 45 | 8/04 | 150 | $55,080 |
| OUST | 34.86 | 30 P   | 0.40 | 0.65 | 0.525 | −0.14 | 3.45 | 1.41× | 141% | 81 | 5/05* | 156 | $54,990 |
| WULF | 22.32 | 20 P   | 0.25 | 0.39 | 0.320 | −0.16 | 1.80 | 1.29× | 113% | 25 | 8/06 | 223 | $54,947 |

\* OUST date is the prior earnings — see caveat above. No forward date in Yahoo `calendarEvents`.

Put subtotal: ~$220,072 margin, ~$27,227 credit (mid).

**Combined: ~$440,220 margin, ~$56,210 credit at mid (≈ 12.8% weekly credit/margin).**

## Liquidity & spread flags

- **OUST 30 P** — 48% spread (0.40 / 0.65). Highest-IV put-side pick but the worst spread of the eight. Either work the limit close to bid (~$0.42) or substitute (next-best earnings-clean alternative: WRBY 25 P at 62% spread — even wider — or FIG 21 P at 17.8% spread but FIG is already on the call side as a strangle).
- **WULF 20 P** — 44% spread (0.25 / 0.39). Liquid (1,387 vol / 1,797 OI) so the spread should compress at the open.
- **NVTS 26 C** — 22% spread but very liquid (1,881 vol / 139 OI just at this strike; whole NVTS chain has 25k+ OI). Should fill near mid.
- **RDW 16.5 C** — 29% spread, 1,209 vol / 195 OI. Acceptable.
- **FIG 26 C** — 13% spread (tightest of any pick). 1,140 vol / 544 OI. Easy fill.
- **NNE 29 C** — 15% spread. 348 vol / 610 OI. Easy fill.
- **ASST 15 P** — 20% spread. 153 vol / 447 OI. Easy fill.
- **UPST 27 P** — 29% spread. 52 vol / 163 OI. Acceptable.

## Differences vs. last Sunday's basket

- **Macro regime:** GSRS 2.64 → 3.26 — crossed from aggressive to defensive band. SKEW, VIX, and MOVE all jumped over the week.
- **Earnings window:** 31 names blocked last week vs. 3 this week — much cleaner expiry week.
- **Picks:** completely fresh — no overlap with last week's basket (FLY, NVTS, FCEL, SMCI / RIOT, WRBY, IBRX, CCL). Only NVTS carries over but at a different strike (last week: 22 C, this week: 26 C — the underlying is up modestly).
- **Sector spread:** Calls = power semi / space / SaaS / nuclear. Puts = asset-mgmt-crypto / fintech / sensors-LiDAR / BTC-mining. No single sector has more than one position.

## Files written / updated this run

`baskets/2026-05-18/data/`:
- `macro_quotes.csv` — fresh 02:11 UTC (18 tickers)
- `SPY_history.csv`, `GSPC_history.csv`, `VIX_history.csv` — fresh 02:11 UTC (122–128 bars)
- `weeklys_universe.csv` — copied from `baskets/2026-05-11/data/` (682 rows, same CBOE weeklys universe as last week — no fresh Cboe pull)
- `universe_quotes.csv` — fresh 02:11 UTC (677 rows)
- `universe_8to40.csv` — fresh 02:12 UTC (199 rows)
- `chains_2026-05-22_v2.csv` — fresh 02:12 UTC (197 tickers, 2 Yahoo HTTP 400 errors: LUNR, PAA)
- `chain_summary_v2.csv` — fresh 02:12 UTC (197 rows)
- `chain_errors_v2.json` — 2 entries
- `shortlist_calls.csv`, `shortlist_calls_refined.csv` — fresh 02:13 UTC (123 / 81 rows)
- `shortlist_puts.csv`, `shortlist_puts_refined.csv` — fresh 02:13 UTC (108 / 49 rows)
- `earnings_dates.json` — fresh 02:13 UTC (86 tickers, 3 in window)
- `shortlist_calls_no_earnings.csv` — fresh 02:14 UTC (81 rows)
- `shortlist_puts_no_earnings.csv` — fresh 02:14 UTC (48 rows)
- `basket_proposal.json` — fresh 02:14 UTC (8 picks, totals, GSRS, macro)
- `refresh_manifest.json` — fresh 02:11 UTC

`scripts/`:
- `_build_basket_2026_05_18_monday.mjs` — new this week. Clone of `_build_basket_2026_05_11_monday.mjs` with curated 2026-05-22 picks. Hard earnings filter applied to candidate list.

## What didn't run

- **TradingView downloader** — `rookiepy` requires access to the user's local Edge/Chrome cookie jar to authenticate against TradingView. The Linux sandbox can't see the user's macOS browser keychain, so the Python downloader bails before touching the screener. **Sixth consecutive run with this skip** — recommend running locally on the Mac to refresh `data_trading_view/`. Most recent TV snapshot remains `data_trading_view/2026-04-19 21-50-16_tradingview_weeklys.csv`.
- **`polytheta-yahoo-downloader` Python CLI** — `python/yahoo_equity_downloader/.venv/pyvenv.cfg` points at `/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11`; the sandbox has Python 3.10 only. The pyproject is pinned `requires-python = ">=3.11"`. Recommend a local rebuild of the venv with `python3.11 -m venv …; pip install -e ./python/yahoo_equity_downloader` so the cron entry can run end-to-end on the host. The Node pipeline covers the same Yahoo dataset for basket purposes; the Python downloader's auxiliary signal exports (FTD, short interest, SEC filings, signal_snapshots, macro extras like HY OAS, P/C) have not been refreshed since the last successful Mac-host run.
- **Weeklys universe Cboe pull** — the prior Sunday's `weeklys_universe.csv` (682 rows) was reused. Cboe's symbol directory could have changed over the week (rare but possible). If a name was added/removed, the basket may miss it.

## Next-Monday checklist (operator)

1. Open `baskets/2026-05-18/data/basket_proposal.json` and review the 8 picks against current quotes at the open.
2. **Reconsider sizing**: GSRS 3.26 is in the 3–6 defensive band. Default basket uses $55k/name; consider scaling to ~$38k/name or dropping the highest-IV names (NVTS, RDW, OUST) if you prefer to wait for VIX to back off.
3. **OUST 30 P, WULF 20 P** are flagged for wide spreads. Either work the limit aggressively close to bid, or substitute.
4. **OUST earnings caveat**: Yahoo shows last earnings date (5/05). Verify no forward date inside 5/18–5/22 before entering the position.
5. Re-verify the full earnings calendar one more time at the open — Yahoo can update over Sunday → Monday. The 3-name block list is current as of 2026-05-18 02:13 UTC.
6. Confirm GSRS still in the 3–6 band Monday morning before final sizing (VIX gap risk in either direction).
7. Place trades manually — Claude does not execute orders.

## Notes

- All file timestamps are UTC.
- This is the sixth consecutive run with the Python `polytheta-yahoo-downloader` and TradingView downloaders skipped due to host-only dependencies. The Node fallback pipeline is fully sufficient for basket generation.
- New `_build_basket_2026_05_18_monday.mjs` follows the same `naked_margin_per_contract` convention as the prior weeks' builders (max of 20%-of-underlying-minus-OTM and 10%-of-strike, plus premium × 100).
