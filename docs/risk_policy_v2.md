# Risk Policy v2 — No Doubles, P&L Stops

**July 26, 2026.** Simulation of exit policies over the 96 fully-documented
settled legs (identical entries, daily Yahoo OHLC, Black-Scholes at entry IV
for mid-week option values). Reproduce with
`node scripts/research/sim_exit_policies.mjs`.

## The question

The locked spec's "double twice then dump" protocol was never modeled in the
published record — the +$304K track record is hold-to-expiry with no
management. Would doubling have helped? And what should the defense be when a
trade goes wrong?

## Results

| Policy | Total (96 legs) | Worst leg | Notes |
|---|---:|---:|---|
| A — hold to expiry (published record) | **+$280,393** | −$115,902 | no defense at all |
| B — double @0.5x ATR, double @1x ATR, dump | +$125,039 | −$29,367 | the spec's protocol |
| C — no doubles, exit at 1x ATR break | +$156,429 | −$18,309 | price-level stop |
| D — no doubles, −25% P&L stop (daily close) | +$266,952 | −$50,916 | checked once a day |
| **D — no doubles, −25% P&L stop (at trigger)** | **+$399,803** | **−$13,770** | real-time monitoring |
| D — −35% P&L stop (at trigger) | +$394,293 | −$19,278 | 2 false stops vs 4 |

## Why doubling loses

These are 10–13%-daily-ATR names. **72 of 96 legs touched the 0.5x ATR break
and 48 touched the full 1x ATR break — but only 10 finished ITM.**38 legs
blew through Break #2 and still expired worthless. Price-level triggers on
names this volatile are noise: the double protocol systematically doubles
into noise and then dumps at panic prices, turning +$280K into +$125K.
Price-level *exits* (C) fail the same way. The instinct that doubling is a
bad idea is confirmed by the system's own data.

## Why the P&L stop wins

A stop on **position P&L** (−25% of the name's allocated margin, per the
spec's own hard-stop rule) ignores price noise entirely and reacts only to
actual damage. Checked in real time it would have produced the best total
AND the smallest worst-leg of any policy — FCEL exits Monday near −$14K
instead of riding to −$116K. The gap between "daily close" and "at trigger"
rows (~$130K) is the value of intraday monitoring: the hourly sync +
stop-breach emails shipped July 26 are what make the trigger row achievable.

## Policy v2 (operational)

1. **Entry defense**: frenzy guard (half-size/skip fresh vertical movers),
   Monday revalidation of stale prices, GSRS put-sizing bands, 2x ATR put
   buffers — all live in the pipeline.
2. **Position defense**: the −25%-of-allocation P&L stop is the single action
   rule. Stop-breach emails fire automatically; exit the name when one
   arrives (verify against the live broker position). No doubling. No exits
   on price levels alone.
3. **Break alerts demoted**: 0.5x/1x ATR breaks are ATTENTION levels for
   monitoring — the basket importer now labels them that way.
4. **Portfolio defense**: 30% total drawdown stop and radar exits unchanged.
5. **Profit side**: 50–70% credit capture unchanged.

## Caveats

Mid-week option values are Black-Scholes at entry IV — real squeeze IV runs
higher, so real stop exits fill worse than the "trigger" row and better than
the "close" row. Fast gaps (NVTS May 18 gapped through the stop into Friday)
can exceed the stop level regardless. n=96 with 10 losers; thresholds are
v1 estimates — rerun the simulation as weeks accumulate. The −25% level
matches the locked spec's hard-stop; −35% trades ~$5K of total for fewer
false stops and is a reasonable alternative.

## Spec status

The locked spec (docs/options_trading_system.md) still describes the double
protocol. This policy supersedes it operationally; the spec document itself
is left untouched — amending it is the trader's call.
