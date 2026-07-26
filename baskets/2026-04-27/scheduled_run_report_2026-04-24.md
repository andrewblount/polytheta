# Scheduled Run Report — 2026-04-24

**Task:** `update-stock-data-and-generate-trades`
**Run timestamp:** 2026-04-24 21:12 UTC
**Target basket:** Monday 2026-04-27 entry / Friday 2026-05-01 expiry

---

## What ran

| Step | Script | Result |
|---|---|---|
| 1. Macro quotes + SPY/SPX/VIX history | `scripts/run_weekly_refresh.mjs` (step 1) | 18 macro tickers, 124-130 history bars each |
| 2. Universe quotes (CBOE weeklys) | `scripts/run_weekly_refresh.mjs` (step 2) | 678 / 679 tickers (0 errors), 201 passed $8-$40 price filter |
| 3. Option chains + IV summary | `scripts/_chains_parallel.mjs 2026-04-27` | 201 / 201 tickers (0 errors, 21s parallel) |
| 4. Shortlist + refine | `scripts/_run_filter_refine_2026_04_27.mjs 2026-04-27` | 81 call candidates / 73 put candidates |
| 5. Basket proposal rebuild | inline builder using refreshed macro + chain mids | 4 calls + 4 puts, ~$438K total margin |

## What didn't run

**TradingView downloader (`polytheta-tradingview-downloader`) and Python Yahoo downloader (`polytheta-yahoo-downloader`)** — the project's `python/*/.venv` directories point to a macOS interpreter path (`/Users/andrewblount/Local/.../.venv/bin/python`) and are not executable inside this session's Linux sandbox. The Node-based `run_weekly_refresh.mjs` + `_chains_parallel.mjs` provides equivalent Yahoo coverage for the CBOE weeklys universe (678 names + SPX + VIX) and was used in place of both. TradingView data was not refreshed; the most recent TradingView snapshot remains `data_trading_view/2026-04-19 21-50-16_tradingview_weeklys.csv`.

To restore the Python downloaders in this sandbox environment, the venvs would need to be recreated against the sandbox's `/usr/bin/python3`:

```bash
rm -rf python/yahoo_equity_downloader/.venv python/tradingview_equity_downloader/.venv
python3 -m venv python/yahoo_equity_downloader/.venv
python/yahoo_equity_downloader/.venv/bin/pip install -e ./python/yahoo_equity_downloader
python3 -m venv python/tradingview_equity_downloader/.venv
python/tradingview_equity_downloader/.venv/bin/pip install -e ./python/tradingview_equity_downloader
```

Note the TradingView downloader additionally relies on `rookiepy` reading local browser cookies — it likely still won't succeed in the sandbox without the user's browser cookie jar, regardless of the venv fix. Both scripts are expected to run cleanly on Andrew's local macOS machine where the original venvs were created.

## Macro snapshot (Friday 2026-04-24 intraday)

| Metric | Value | 1-day change |
|---|---|---|
| SPY | 713.94 | — (52w high 714.47) |
| SPX | 7,165.08 | — (all-time high neighborhood) |
| VIX | 18.71 | −0.60 from prior close (19.31) |
| SKEW | 139.59 | — |
| MOVE | 66.97 | — |
| HY OAS | 2.86% (carried) | — |

**GSRS ≈ 2.53** → 0–3 band: full aggressive 5% sizing both sides; doubles enabled on both sides. Effectively unchanged from the 20:03 run (2.54) and last week (2.6).

## Basket (8 names, same curated selection as the 20:03 run; mids refreshed)

### Call side (bearish — sell OTM calls)
| Ticker | Px | Strike | Bid | Ask | Mid | ATR(14) | ATR buffer | Option IV | HV Rank |
|---|---|---|---|---|---|---|---|---|---|
| ENPH | 35.77 | 43 Call | 0.59 | 0.92 | 0.76 | 1.91 | 3.8× | 135% | 28 |
| NN | 17.71 | 22 Call | 0.35 | 0.55 | 0.45 | 2.03 | 2.1× | 159% | 99 |
| GLXY | 26.00 | 30 Call | 0.34 | 0.55 | 0.45 | 1.88 | 2.1× | 107% | 24 |
| RIVN | 16.52 | 18.5 Call | 0.29 | 0.31 | 0.30 | 0.76 | 2.6× | 96% | 15 |

### Put side (bullish — sell OTM puts)
| Ticker | Px | Strike | Bid | Ask | Mid | ATR(14) | ATR buffer | Option IV | HV Rank |
|---|---|---|---|---|---|---|---|---|---|
| POET | 15.10 | 12 Put | 0.30 | 0.38 | 0.34 | 1.33 | 2.3× | 172% | 100 |
| ZETA | 17.53 | 15.5 Put | 0.39 | 0.49 | 0.44 | 0.99 | 2.1× | 122% | 47 |
| RIOT | 18.61 | 16.5 Put | 0.27 | 0.32 | 0.30 | 1.27 | 1.7×* | 99% | 42 |
| SMR | 11.96 | 10.5 Put | 0.16 | 0.20 | 0.18 | 1.33 | 1.1×* | 102% | 70 |

\* Below the 2× ATR mean-reversion buffer target. Acceptable while GSRS < 3 and puts doubles enabled; flagged in the basket markdown.

## Files updated

- `baskets/2026-04-27/data/macro_quotes.csv` — fresh at 21:09 UTC
- `baskets/2026-04-27/data/universe_quotes.csv` — fresh at 21:09 UTC
- `baskets/2026-04-27/data/universe_8to40.csv` — fresh at 21:09 UTC
- `baskets/2026-04-27/data/{SPY,GSPC,VIX}_history.csv` — fresh at 21:09 UTC
- `baskets/2026-04-27/data/chains_2026-05-01_v2.csv` — fresh at 21:11 UTC
- `baskets/2026-04-27/data/chain_summary_v2.csv` — fresh at 21:11 UTC
- `baskets/2026-04-27/data/shortlist_calls{,_refined}.csv` — fresh at 21:11 UTC
- `baskets/2026-04-27/data/shortlist_puts{,_refined}.csv` — fresh at 21:11 UTC
- `baskets/2026-04-27/data/basket_proposal.json` — fresh at 21:14 UTC
- `baskets/2026-04-27/data/refresh_manifest.json` — fresh at 21:14 UTC

## Human-curated basket markdown

`baskets/2026-04-27-basket.md` (written at 20:05 UTC in the earlier manual run) remains the canonical entry document for Monday. It already incorporates the `bid > 0` liquidity rule, earnings-risk flag on ENPH, and the ATR-buffer overrides for RIOT + SMR. No changes were made to it in this refresh — verify ENPH's earnings date and all radar statuses before Monday open.

## Choices made without the user present

1. **Used Node refresh in place of Python downloaders.** The Python venvs cannot run in this sandbox. Node coverage matches the CBOE weeklys + SPX/VIX scope that the task file names; reported clearly above.
2. **Preserved the curated 20:03 basket selections** (ENPH/NN/GLXY/RIVN calls + POET/ZETA/RIOT/SMR puts) rather than replacing them with a fresh algorithmic pick. Rationale: the 20:03 run already applied thesis / earnings-risk / manual-quality filters that this automated pass cannot reproduce, and the underlying data moved less than 0.5% between 20:03 and 21:14. Only bid/ask/mid values were refreshed.
3. **Carried HY OAS at 2.86%** (it is not in the Yahoo feed) — same treatment as prior runs.
4. **No broker / trading actions taken.** Task file did not request order placement.
