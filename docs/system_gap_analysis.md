# System Gap Analysis — July 26, 2026

A review of the automated weekly pipeline against the locked spec in
[options_trading_system.md](./options_trading_system.md), using the 14 settled
weeks of modeled results now in the site database. Items marked **fixed** were
changed in the July 26 commits; items marked **open** need your judgment.

## What the settled record shows

14 settled weeks, modeled at recommended entries held to expiry: **+$304,270
total, 10 winning weeks, 96 of 106 legs (90.6%) expired worthless.** Worst
week −$64,857 (May 11), worst single leg FCEL call −$115,902 (entered May 11
at $13.70, settled $21.36 — a +56% weekly move).

Two honesty notes:

1. The spec's claimed validation ("+8.7% average weekly return, 81% win rate,
   52-week walk-forward") does not match the realized record (~+$21.7K/week
   average on ~$440K margin, 71% weekly hit rate). The claimed backtest was
   part of an AI-generated prompt and shows the hallmarks of fiction. The
   Performance page now tracks the real number.
2. The modeled record is **not** the system as documented. It assumes hold to
   expiry with no management. Your spec's 25%-of-allocation name stop would
   have cut FCEL at roughly −$13.8K instead of −$115.9K; your doubles protocol
   would have added exposure elsewhere. The record measures screening quality
   only.

## Rule-by-rule

| Spec rule | Was | Now | Status |
|---|---|---|---|
| Put strike ≥ 2× ATR below spot ("strictly") | 1.0× floor. **All 6 settled losing puts entered below 2×** (NOK 1.15×, RKT 1.38×, DKNG 1.38×, DOW 1.39×, UPST 1.21×, RUN 1.89×) | 2.0× enforced at strike re-selection; names with no compliant strike drop out | **fixed** |
| GSRS 3–5: halve put sizing, no put doubles | GSRS computed, never applied — July 20 ran full-size puts at GSRS 3.04 | Put budget halves at ≥3, put entries blocked at ≥5, hedge flagged at ≥7; alert notes say "EXIT PROTOCOL ONLY" when doubles are prohibited | **fixed** |
| Delta 0.15–0.20 | Selector tolerated 0.13–0.22; entries went out at 0.117–0.208 | Hard band at strike selection | **fixed** |
| Spread ≤ $0.10–0.15 | Not checked (OUST went out at $0.40) | ≤ $0.15 enforced | **fixed** |
| ≥500 contracts OTM volume | 300 | 500 | **fixed** |
| Universe $8–$100 | Drifted to $8–$40 — which structurally emptied the put side under the 2× ATR + delta rules (the tier-1 put names trade $40–$100) | Restored to $8–$100 from next Monday's run | **fixed** |
| Short interest (call ≥20%, put <15%) | Never evaluated, stored as 0 | Fetched live from Yahoo for the candidate pool, ranked into selection, stored on positions, shown on site | **fixed** |
| Call-side buyback = 0, active buyback disqualifying | Never evaluated | Enforced via `baskets/thesis_overrides.json` when you maintain it; unknown never counts as pass | **partial — needs your weekly input** |
| Fan score, Glassdoor, radars | Never evaluated | Same overrides file; coverage (k/5) reported on every pick, in RUN_SUMMARY and on the site | **partial — needs your weekly input** |
| 3-of-5 thesis confirmation | Unenforceable (0–1 signals known) | Enforceable once you maintain overrides; coverage warnings until then | **open** |
| IV rank ≥ 80th percentile | HV-rank ≥55 OR ATM IV ≥55% as proxy | Unchanged — Yahoo has no IV history. HV rank is a weak proxy; consider an IV-history source (ORATS, Market Chameleon) | **open** |
| 25% name stop / 30% portfolio stop / doubles / 50–70% profit-taking | Not modeled, not alerted | Hourly snapshots during live weeks make stop-breach detection possible; not yet implemented | **open** |
| Sector ≤50% of risk | Keyword-based family cap of 2 per side | Unchanged; family taxonomy is name-keyword-based and crude | **open** |

## Counterfactual: July 20 under enforced rules

Same data, new rules: calls became BTDR/IREN/HIMS/NNE — every one with
confirmed SI ≥ 27% (OUST dropped for its $0.40 spread, DJT for delta 0.208).
Put budget correctly halved at GSRS 3.04. Put pool was **empty** in the $8–$40
universe — no strike could satisfy 2× ATR + delta band + credit ≥ $0.10, which
is exactly why the universe restoration matters: your manual-era put names
(F, GM, HOOD, PINS) all satisfied both constraints from the $40–$100 range.

## Operational fixes also in these commits

The system itself (spec, orchestrator, downloaders, basket history) is now in
git — before, only the website was tracked. The hourly sync stops re-pricing
settled positions (22.5K junk snapshots cleaned). The orchestrator publishes
each Monday basket to the site automatically. `schwab/` and `private/` are
gitignored (account data and keys stay local).

## What still needs you

1. **Maintain `baskets/thesis_overrides.json`** — buyback, fan, Glassdoor,
   radar per candidate. Without it the pipeline can only verify SI, and your
   most important call-side protections (buyback disqualifier, acquisition
   radar) stay judgment calls outside the system.
2. **Decide on an IV-rank data source** if you want the 80th-percentile rule
   enforced as written.
3. **Intra-week management alerts** (stop breaches, 50–70% capture targets)
   are the next highest-value build: FCEL-class losses are managed by stops,
   not by screening.
