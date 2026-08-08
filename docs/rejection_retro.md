# Rejection retro, every candidate the system said no to

Generated 2026-08-08 by `scripts/research/replay_rejections.mjs`.
Method: for each settled week, every name on the refined shortlist that was
not picked is settled at that week's expiry, using the strike and credit the
pipeline itself computed for it on the Sunday (`best_<side>_strike`,
`best_<side>_credit`). Sizing matches the sample autopsy's margin proxy, so
numbers are comparable, and all P&L is modeled at expiry, not traded.

Settled weeks covered: 14.
Rejected legs settled: 1490 (789 calls, 701 puts). Picked legs seen alongside: 82.

## Did the filters pay for themselves?

| Slice of the rejected pool | n | win rate | avg P&L | total P&L |
|---|---|---|---|---|
| Frenzy guard (would flag) | 246 | 83% | +$239 | +$58,739 |
| Frenzy hard skip | 43 | 81% | +$142 | +$6,098 |
| Calm (guard passes) | 1244 | 83% | +$226 | +$281,473 |
| Outside $8-$100 band | 0 | 0% | +$0 | +$0 |
| Inside band | 1490 | 83% | +$228 | +$340,212 |
| ATR buffer under 2x | 1305 | 82% | +$146 | +$190,276 |
| ATR buffer 2x or more | 185 | 90% | +$810 | +$149,936 |

Read the frenzy rows against the calm row. If frenzied rejects lost money
on average, the guard is doing its job on the names it never even showed
you. If calm rejects made money, that is the premium left on the table by
capacity, not by a filter, and arguing with it means arguing for a bigger
basket, not looser screens.

## Side by side

| Side | n | win rate | avg P&L | total P&L |
|---|---|---|---|---|
| Rejected calls | 789 | 87% | +$217 | +$171,484 |
| Rejected puts | 701 | 78% | +$241 | +$168,728 |

## The ten rejections that hurt most to skip

| Week | Ticker | Side | Credit | Settle vs K | P&L |
|---|---|---|---|---|---|
| 2026-04-27 | NN | put | $0.625 | 19.38 vs 15 | +$3,125 |
| 2026-05-04 | NVTS | put | $0.57 | 18.20 vs 15 | +$2,850 |
| 2026-06-01 | NCLH | put | $0.56 | 18.75 vs 15.5 | +$2,688 |
| 2026-07-27 | NVTS | put | $0.335 | 10.86 vs 9.5 | +$2,647 |
| 2026-05-26 | BKKT | put | $0.35 | 10.87 vs 10 | +$2,625 |
| 2026-05-04 | OUST | put | $0.775 | 25.20 vs 22.5 | +$2,558 |
| 2026-08-03 | GLXY | put | $0.6 | 20.17 vs 18 | +$2,520 |
| 2026-07-06 | GLXY | put | $0.69 | 24.88 vs 21 | +$2,484 |
| 2026-06-01 | GTLB | put | $0.875 | 31.12 vs 27 | +$2,450 |
| 2026-05-04 | SOUN | put | $0.26 | 8.88 vs 8 | +$2,444 |

## The ten the screens were right about

| Week | Ticker | Side | Credit | Settle vs K | P&L |
|---|---|---|---|---|---|
| 2026-05-26 | UMAC | call | $0.275 | 31.78 vs 19 | -$48,770 |
| 2026-05-11 | ENPH | call | $0.425 | 52.89 vs 40 | -$23,683 |
| 2026-05-26 | ONDS | call | $0.11 | 13.22 vs 10 | -$23,325 |
| 2026-05-18 | RGTI | call | $0.315 | 26.42 vs 20 | -$23,199 |
| 2026-05-18 | QBTS | call | $0.35 | 29.40 vs 22.5 | -$21,615 |
| 2026-05-11 | OUST | call | $0.375 | 34.86 vs 28.5 | -$15,561 |
| 2026-06-15 | HIMS | call | $0.355 | 35.47 vs 29.5 | -$14,038 |
| 2026-06-22 | NNE | put | $0.5 | 19.87 vs 25 | -$13,890 |
| 2026-05-26 | RDW | call | $0.4 | 24.57 vs 20.5 | -$13,579 |
| 2026-05-26 | SMCI | call | $0.455 | 46.09 vs 39 | -$12,607 |

Raw legs with every flag: `baskets/retro_cache/rejections.json`.
