# Trade Autopsy — FCEL Call, Week of May 11, 2026

The worst leg in the system's history: short 282 FCEL May-15 $17 calls at
$0.25 credit, modeled loss **−$115,902** — 38% of all losses across 14 settled
weeks came from this one position.

## What the system saw Sunday night

FCEL at $13.70 (Friday close), strike $17 = 24% OTM, 1.90× ATR buffer, delta
0.142, option IV 179%, HV rank 98, spread $0.10, earnings June 5 (clear).
Every screen the pipeline ran at the time said yes — the premium looked rich
because realized vol "justified" it.

## What actually happened

- **Fri May 8**: FCEL closes **+11.6%** ($12.28 → $13.70) on AI data-center
  power-demand optimism and the launch of its 12.5 MW platform — part of a
  rally that had FCEL up ~340% YTD. The move was structural narrative, not a
  fading "hope rally."
- **Mon May 11 (entry day)**: closes $15.94, **+16% above the proposal
  price**. The 24% OTM cushion was ~7% by the first close. Every entry
  assumption (strike distance, buffer, credit) was stale before the open.
- **Tue–Thu**: $17.09 → $19.92 → $21.60. Blew through the strike Wednesday.
- **Fri May 15**: settles $21.36. Intrinsic $4.36 against $0.25 collected.

## Why the loss was this big

1. **The screen is structurally attracted to fresh breakouts.** It ranks
   call candidates by option IV, and IV is highest immediately after a
   violent move. The screen kept handing the system names mid-squeeze.
2. **No entry revalidation.** The basket was built on Friday closes; nothing
   re-checked prices Monday morning. FCEL entered 16% below reality.
3. **No stop enforcement in practice.** The spec's 25%-of-allocation stop
   (−$13.7K on this name) would have cut the loss ~88% by Tuesday. Nothing
   monitored it.
4. Note: the delta band (0.15–0.20) does **not** protect against this — a
   +56% weekly move destroys any far-OTM call. Only screening, revalidation,
   sizing, and stops help.

## The pattern generalizes — all four ITM call losses

| Week | Ticker | Pre-entry thrust | Loss |
|------|--------|------------------|------|
| May 11 | FCEL | **+11.6% last session** | −$115,902 |
| May 18 | NVTS | **+22% over 10 sessions** (after +35% the week before) | −$50,400 |
| May 18 | RDW | **+21.6% over 3 sessions** | −$17,600 |
| Jun 15 | CIFR | **+8.3% last session** | −$21,328 |

Validation across **all 53 settled call legs**: legs entered with thrust
above the guard thresholds averaged **−$4,133**; calm entries averaged
**+$7,070**. The calm entries make all the money. (n=53, 4 losers — treat
thresholds as v1, revisit with more data.)

## Changes shipped (July 26, 2026)

1. **Frenzy guard** in the pipeline: pre-entry thrust (1d/3d/10d) is now
   computed for every candidate. ≥8%/15%/20% → **half size** + caution flag
   (mirrors the spec's Fan ≥8 half-sizing rule, applied mechanically);
   1d ≥15% or 3d ≥25% → **skip**. Calm names outrank frenzied ones at equal
   thesis rank, breaking the IV sort's structural pull toward squeezes.
   Half-sizing alone would have added **+$39K** across the sample.
2. **Monday revalidation** (`scripts/verify_basket_live.mjs` +
   `com.polytheta.monday-revalidate.plist`, Mon 07:35/08:35 local): re-quotes
   every pick after the open, flags names that moved >4% / >0.5 ATR adverse
   or whose live ATR buffer fell under the floor, writes REVALIDATION.md and
   emails when anything is stale. FCEL would have been flagged before entry.
3. **Stop-breach alerts**: the hourly sync now emails the moment any live
   position's modeled P&L crosses −25% of its margin (once per position),
   and the mobile API flags it. The FCEL email would have arrived Monday
   afternoon; the stop caps the damage near −$14K instead of −$116K.

## What this can't fix

Stops assume you can exit near the trigger — gaps through the stop are still
possible on these names. The guard trades some winner premium for tail
protection; at half size the sample says that trade is strongly positive.
And modeled P&L is entry-at-recommendation, held-to-expiry — your executed
results depend on fills and on actually taking the stop when the email lands.
