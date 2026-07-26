# Scheduled Run Report — 2026-05-04 (Monday Entry, Friday Refresh)

**Task:** `update-stock-data-and-generate-trades`
**Run:** 2026-05-01 21:13 UTC (automated)
**Target basket:** Monday 2026-05-04 entry / Friday 2026-05-08 expiry

---

## TL;DR

- All Yahoo-side data refreshed end-to-end: macro, history, universe quotes, option chains, IV summary, refined shortlists, earnings dates, no-earnings shortlists, basket proposal.
- **Earnings season is heavy this week:** 41 of 87 refined shortlist tickers report between 2026-05-04 and 2026-05-08, including most of the highest-IV names (FSLY, SOUN, NVTS, FUBO, TTD, PINS, CIFR, SMCI, CELH, CORZ, SMR — all blocked).
- Final basket: **GME, ASST, FCEL, FIGR (calls) + SGML, APLD, GLXY, PL (puts).** All 8 are earnings-clean for the holding window.
- Total credit ~$64,240 against ~$439,845 margin → **~14.6% weekly credit/margin**, in line with last week's 14.7%.
- Buffers softer than target (only GME ≥2× ATR), reflecting the same "high-IV names are mostly earnings names" dynamic from last week.
- **TradingView download skipped** — same macOS-venv / `rookiepy` cookie-jar limitation in the Linux sandbox as the prior two runs. Most recent TradingView snapshot remains `data_trading_view/2026-04-19 21-50-16_tradingview_weeklys.csv`.
- **No orders placed.**

---

## What ran

| Step | Script | Result |
|---|---|---|
| 1. Macro quotes + SPY/SPX/VIX history | `scripts/run_weekly_refresh.mjs` (auto-discover; partial run) | 18 macro tickers, 124–130 bars each |
| 2. Universe quotes (CBOE weeklys) | `scripts/run_weekly_refresh.mjs` (step 2) | 678 / 679 tickers (0 errors), 199 in $8–$40 band |
| 3. Option chains + IV summary | `scripts/_chains_parallel.mjs 2026-05-04` | 199 / 199 tickers (0 errors) |
| 4. Shortlist + refine | `scripts/_run_filter_refine_2026_04_27.mjs 2026-05-04` | 79 call candidates / 70 put candidates |
| 5. Earnings dates fetch | `scripts/_fetch_earnings_dates_2026_05_04.mjs 2026-05-04 2026-05-08` (NEW) | 87 tickers, 41 with earnings 5/4–5/8 |
| 6. Earnings filter + rerank | `scripts/_filter_earnings_and_rank.mjs 2026-05-04 2026-05-04 2026-05-08` | 39 calls / 36 puts surviving |
| 7. Basket proposal | `scripts/_build_basket_2026_05_04_monday.mjs` (NEW; hard earnings filter) | 4 calls + 4 puts |
| 8. Manifest | inline | `refresh_manifest.json` written |

The auto-discovering `run_weekly_refresh.mjs` correctly derived `basket_date=2026-05-04` and `expiry=2026-05-08` from today's date (Fri 2026-05-01) via its `nextMonday` / `nextFriday` helpers. Step 3 of that script timed out on the sandbox's 45-second per-call limit, so I ran the parallel chain fetcher (`_chains_parallel.mjs`) separately to complete it.

## Macro snapshot (Friday 2026-05-01 close)

| Metric | Value | vs 2026-04-27 |
|---|---|---|
| SPY | 720.65 | +7.77 (+1.09%) |
| SPX | 7,230.12 | +77.98 (+1.09%) |
| VIX | 16.99 | −1.75 |
| SKEW | 143.33 | +4.25 |
| MOVE | 70.41 | +3.44 |
| HY OAS | 2.86% (carried — TV refresh skipped) | — |

**GSRS = 2.76** → 0–3 band: full aggressive sizing both sides; doubles enabled. Vol component fell sharply (VIX 18.74 → 16.99) but SKEW ticked up.

## Names excluded for earnings during 2026-05-04 → 2026-05-08

Pulled from `quoteSummary.calendarEvents` for all 87 candidates. **41 names blocked** — about double last week's 14:

**Mon 5/04:** FLY, NCLH, PINS, PSKY
**Tue 5/05:** BTU, CIFR, CPNG, HL, JOBY, LUMN, NVTS, OUST, SMCI, UPST
**Wed 5/06:** CDE, CORZ, FSLY, FUBO, KHC, NVAX, OSCR, RDW, RUN, UUUU
**Thu 5/07:** CELH, CLSK, DKNG, LYFT, MARA, QXO, RCAT, RKT, SERV, SMR, SOUN, TOST, TTD, U, UAMY, UMAC
**Fri 5/08:** WULF

This wave wipes out most of the names that survived screening on raw IV alone — every one of last week's puts (CORZ, TTD, SOC implicitly, SMR) reports this week, so the put side had to be rebuilt almost entirely.

## Final earnings-clean basket (8 names)

### Call side (sell OTM calls)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GME  | 26.53 | 29.5 C  | 0.39 | 0.42 | 0.405 | 0.19 | 0.99 | 2.99× | 86%  | 21 | 6/09 | 164 | $55,022 |
| ASST | 16.31 | 18.5 C  | 0.25 | 0.34 | 0.295 | 0.19 | 1.37 | 1.60× | 102% | 2  | 5/14 | 256 | $54,912 |
| FCEL | 13.31 | 16   C  | 0.20 | 0.35 | 0.275 | 0.17 | 1.46 | 1.85× | 134% | 94 | 6/05 | 293 | $54,938 |
| FIGR | 36.45 | 40.5 C  | 0.35 | 0.95 | 0.65  | 0.20 | 2.35 | 1.72× | 92%  | 8  | 5/11 | 117 | $54,990 |

Call subtotal: ~$219,862 margin, ~$29,857 credit (mid).

### Put side (sell OTM puts)
| Ticker | Px | K | Bid | Ask | Mid | Δ | ATR | ATR buf | IV | HVR | Earnings | Contracts | Margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SGML | 21.97 | 19   P  | 0.30 | 0.85 | 0.575 | −0.18 | 1.76 | 1.69× | 137% | 24 | 5/14 | 222 | $54,945 |
| APLD | 33.55 | 30   P  | 0.52 | 0.58 | 0.55  | −0.17 | 2.70 | 1.32× | 96%  | 16 | (4/08 done) | 148 | $54,908 |
| GLXY | 28.11 | 25.5 P  | 0.33 | 0.48 | 0.405 | −0.17 | 1.97 | 1.32× | 83%  | 9  | 7/28 | 161 | $55,014 |
| PL   | 36.90 | 33.5 P  | 0.45 | 0.70 | 0.575 | −0.18 | 3.13 | 1.08× | 86%  | 31 | 6/03 | 121 | $55,116 |

Put subtotal: ~$219,983 margin, ~$34,383 credit (mid).

**Combined: ~$439,845 margin, ~$64,240 credit at mid (≈ 14.6% weekly credit/margin).**

### Buffer flags

- **Only GME (2.99×) hits the 2× ATR target.** Same root cause as last week — the highest-IV names are concentrated around earnings binaries that are now excluded.
- **PL 1.08× ATR — well below 2× target.** It's the lowest-buffer name in the basket and was kept primarily for sector diversification (satellite/data analytics — every other put-side option was metals, crypto, or data center). Recommend reviewing before entry; the next-strike-down ($33) gives more buffer at a markedly lower credit.
- **APLD and GLXY both at 1.32×** — acceptable but worth flagging that two of the four put names are below 1.5×.
- All call-side buffers ≥ 1.6×.

### Liquidity / spread flags

- **TSSI was the highest-IV earnings-clean put option** (152%, 1.60× buf) but its bid/ask is 0.10/0.90 — completely untradeable mid. Excluded for liquidity.
- **FIGR 40.5 C bid/ask 0.35/0.95** is wide. The mid (0.65) is what the script used; expect to work the limit closer to the bid in practice. OI=11 on this strike; consider FIGR 41 C as an alternative.
- **SGML 19 P bid/ask 0.30/0.85** is also wide (open interest only 7 contracts on this strike). Liquidity risk on entry and exit; size cautiously or substitute.

### Sector composition

- Calls: GME (specialty retail / meme), ASST (asset mgmt holding), FCEL (fuel cells / clean energy), FIGR (fintech). No two names in the same sector.
- Puts: SGML (lithium), APLD (AI/data center), GLXY (digital assets), PL (satellite/geospatial). Reasonably spread.
- No ticker appears on both sides; ASST is on the call side only this week (last week it ranked highly on both).

## What didn't run

**TradingView downloader and the Python `polytheta-yahoo-downloader`** — the project's `python/*/.venv` directories still point to a macOS interpreter path (`/Library/Frameworks/Python.framework/Versions/3.11/bin/python3`), so the venvs cannot execute in this Linux session sandbox. The TradingView script additionally needs `rookiepy` to read the user's local browser cookie jar, which would still fail in the sandbox after a venv rebuild. Same as the 2026-04-24 and 2026-04-27 runs. Run on local Mac to refresh the TradingView dataset.

Most recent TradingView snapshot remains `data_trading_view/2026-04-19 21-50-16_tradingview_weeklys.csv` (12 days stale).

HY OAS in the macro panel is carried at 2.86% from the last TradingView snapshot.

## Files written / updated

```
baskets/2026-05-04/data/
  ├── weeklys_universe.csv            (copied from 2026-04-27 — same CBOE list)
  ├── macro_quotes.csv                (18 tickers @ 2026-05-01 21:09 UTC)
  ├── SPY_history.csv                 (124 bars)
  ├── GSPC_history.csv                (124 bars)
  ├── VIX_history.csv                 (130 bars)
  ├── universe_quotes.csv             (678 rows)
  ├── universe_8to40.csv              (199 rows)
  ├── chains_2026-05-08_v2.csv        (full chain, ~5800 rows)
  ├── chain_summary_v2.csv            (199 rows)
  ├── shortlist_calls.csv             (79 raw)
  ├── shortlist_calls_refined.csv     (refined ranked)
  ├── shortlist_puts.csv              (70 raw)
  ├── shortlist_puts_refined.csv      (refined ranked)
  ├── earnings_dates.json             (87 tickers, 41 in-window)
  ├── shortlist_calls_no_earnings.csv (39 survivors)
  ├── shortlist_puts_no_earnings.csv  (36 survivors)
  ├── basket_proposal.json            (final basket — 8 names)
  └── refresh_manifest.json
scripts/
  ├── _fetch_earnings_dates_2026_05_04.mjs   (NEW — parameterized hold-window)
  └── _build_basket_2026_05_04_monday.mjs    (NEW — earnings-aware build)
```

The reusable filter/rerank script (`_filter_earnings_and_rank.mjs`) already takes the holding window as CLI args and was reused as-is.

The **human-curated basket markdown** at `baskets/2026-05-04-basket.md` was **not created**. The structured proposal in `basket_proposal.json` is the source of truth from this automated run; whether to write a curated `.md` is your call.

## Choices made without the user present

1. **Picked GME, ASST, FCEL, FIGR (calls) and SGML, APLD, GLXY, PL (puts)** — top of the earnings-clean rerank by composite (IV × buffer × credit), filtered for sector diversification and liquidity.
2. **Excluded TSSI** despite being top of the put-side rerank by composite — bid/ask (0.10/0.90) is untradeable. Replaced with the next sector-diverse name (PL).
3. **Kept PL at 1.08× ATR buffer** for sector diversification, even though it's below the 2× target. Flagged for manual review.
4. **Did not regenerate `baskets/2026-05-04-basket.md`** — that's a human-curated entry document.
5. **Did not run TradingView refresh** — known sandbox limitation, same as last two weeks.
6. **Did not place any orders.**
7. **Created `_fetch_earnings_dates_2026_05_04.mjs`** as a one-off because the existing `_fetch_earnings_dates.mjs` had the prior week's holding window hard-coded in its diagnostic print. Only the print logic differs; both write the same JSON shape.

## Recommended follow-ups

1. **Make TradingView reachable from automation** — either (a) rebuild the macOS venv on Linux or move TradingView fetch onto the local Mac on a Friday cron, or (b) accept the current pattern and stop describing it as a failure.
2. **Promote `_fetch_earnings_dates_2026_05_04.mjs` and `_filter_earnings_and_rank.mjs` into the canonical refresh path** so the refined shortlist is earnings-clean by construction (per last week's recommendation).
3. **Re-evaluate PL** before entry given its 1.08× ATR cushion — the $33 strike trades cushion for credit and may be the better pick.
4. **Verify Federal Reserve / FOMC calendar for the 5/4–5/8 week** — last week's report flagged FOMC 4/30 as mid-window risk; check for any policy events this week before sizing up.
