# Put-side review, the treatment the calls got in May

Generated 2026-08-08. 50 settled put legs, 7 finished in the money.

The May autopsy validated the frenzy guard on calls: upward thrust into
entry predicted call losses. Puts fail the opposite way, on names already
falling, so the symmetric question is whether *downward* thrust into entry
predicts put losses.

Upward-frenzied entries: n 9, avg +$1,084.
Calm entries: n 41, avg +$349.
Downward-thrust entries (1d under -8%, 3d under -15%, or 10d under -20%): n 1, avg +$1,313.

Put legs that finished in the money (a small breach can still net positive against its credit), each with a generated autopsy in docs/autopsies:

| Week | Ticker | Settle vs K | P&L |
|---|---|---|---|
| 2026-05-26 | DOW | 33.75 vs 34 | +$143 |
| 2026-06-01 | UPST | 29.74 vs 31.5 | -$3,084 |
| 2026-06-01 | RUN | 13.35 vs 15 | -$7,050 |
| 2026-06-15 | NOK | 13.49 vs 13.5 | +$868 |
| 2026-06-15 | DKNG | 26.39 vs 27 | -$1,218 |
| 2026-07-13 | NOK | 10.12 vs 11.5 | -$8,093 |
| 2026-07-20 | RKT | 13.05 vs 13.5 | -$1,876 |

If the downward-thrust row is negative and the calm row is positive, the
guard should gain a mirrored threshold for puts. If not, put selection is
not where the risk lives and the guard stays call-only.
