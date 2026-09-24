# PolyTheta: entry timing and entry prices

September 10, 2026. **Owner-approved rules.** The owner also added a per-ticker maximum loss exception, described in [the full trading rules](trading_rules.md). Allocation rules and minimum OTM rules remain in place. Live IB trading is not activated.

## 1. Choose when to enter

Settings offers two choices for each new weekly basket:

| Choice | Entry time, New York time | Expiry |
|---|---|---|
| Friday close | Last five minutes of Friday’s options session | The following week’s final options session |
| Monday morning | A configurable morning window; default 09:45–10:30 | That week’s final options session |

If Friday is a holiday, use the **preceding trading session’s close**, as requested. If that session closes early, use its actual early close. If Monday is a holiday, use the first trading session of the week. A Friday expiry holiday also moves expiry to the preceding trading session. Always verify that the exact option exists at IB.

Examples: a regular Friday window is 15:55–16:00. A 13:00 early close gives a 12:55–13:00 window. Friday-close and Monday-morning modes target the **same following-Friday expiry**, not a five-minute option expiring on the entry Friday.

## 2. Allow enough time to build the basket

Friday-close mode must not depend on a weekend run:

1. Start the full universe download and screening ahead of the close. Default: **90 minutes before the close**, configurable.
2. Preserve progress and retry failed reads while there is time. This first result is a preparation basket, not permission to trade.
3. Refresh the selected candidates shortly before entry. Default: start this final refresh **10 minutes before the five-minute entry window**. At a regular close, that is 15:45.
4. Recheck prices, exact expiry, IV, minimum OTM, delta/ATR, earnings, exclusions and news. Publish/email the finalized basket with its actual source timestamps and planned entry time.
5. At 15:55, the IB worker begins evaluating entries using fresh IB quotes. It rechecks each trade immediately before submission.
6. If preparation or final checks do not finish in time, skip the affected entry. **Never extend Friday entries past the options close, substitute an expiry, or silently enter on Monday instead.**

Monday mode may keep a dated Friday preparation snapshot, but must refresh and revalidate it Monday morning. It can retry within the chosen Monday window. An unfinished basket does not become an automatic Tuesday/Wednesday entry, except that a Monday holiday moves the window to the first session.

## 3. Keep stock and option timestamps separate

The stock can trade after the option’s regular session ends. Therefore a Friday option premium and a later stock price are **not a simultaneous tradable quote**.

Save the reference option premium, reference stock price, option IV, VIX, exact contract and their observation times. Extended-hours stock prices can inform a clearly labeled projection, using their actual timestamps. Do not assume the stock returns to Friday’s close. Do not label a Friday option quote as a live Monday quote.

When submitting an order, require the options session to be open, a fresh real-time IB option bid/ask, and a fresh underlying price. A premarket stock quote by itself cannot authorize a trade.

## 4. Recalculate Monday’s expected premium

Reprice the **same strike and expiry** using:

- **Time:** the actual remaining calendar time until the option’s exchange-adjusted expiry close. Friday afternoon to Monday morning is more than two days; a holiday weekend is longer. Do not simply subtract “two days × Friday theta,” because theta changes as expiry approaches.
- **Stock price:** the current underlying price, including the weekend gap. There is no assumed return to Friday’s price.
- **IV:** prefer current IV for the exact option. If that is unavailable, use the VIX change as a labeled approximation:

  `estimated IV now = reference option IV × (VIX now / reference VIX)^sensitivity`

  Default sensitivity is **1**, configurable. Example: reference option IV80%, VIX20→25 gives estimated IV100%. VIX measures S&P500 volatility, so this is an approximation for an individual stock, not its measured IV.

The pricing formula anchors the estimate to the observed option premium:

`expected premium now = reference premium × [model value with current stock price, current IV and remaining time] / [model value at the reference stock price, reference IV and reference time]`

The model is Black–Scholes with explicit rate/dividend assumptions. The annual risk-free rate defaults to 4%, configurable from 0% to 20%; it is a modeling assumption, not a live rate feed. Dividend yield defaults to zero unless present in the reference. It is an approximation for American stock options; IB quotes and actual fills remain authoritative. Missing/invalid inputs or an unstable near-zero denominator block the estimate.

Show the original premium, elapsed time, stock-price change, IV source, time effect, stock-price effect, IV effect and resulting expected premium. This makes it possible to see why Monday’s estimate differs from Friday’s.

Fresh Monday option prices already reflect elapsed time and market changes. **Do not subtract weekend decay again from a fresh Monday quote.** Keep the Friday-to-Monday comparison separate from the current quote.

## 5. Convert the estimate into an actual order

1. Apply the existing entry rules to current data. If the weekend move means the selected strike fails minimum OTM, delta or ATR requirements, block it or rebuild before entry; never force that stale strike into the account.
2. Compare the current IB market with the adjusted expected premium. The configurable minimum-credit ratio applies to the **adjusted estimate**, not an untouched Friday premium. At the current90% setting, an adjusted $0.60 estimate gives a $0.54 floor, rounded up to a valid option tick and subject to the existing $0.10 minimum.
3. Start with a sell limit near the current bid/ask midpoint. Reprice within the credit floor and entry window. Confirm IB capacity and margin before sending.
4. Stop new entries when the configured window ends; cancel remaining working entry quantities. A Monday DAY order can remain working until session end if the worker loses connectivity before cancellation; the morning deadline is currently worker-enforced. Preserve partial fills and never re-enter an already attempted basket allocation.
5. Record **the actual IB fill** and commission separately. An estimate, midpoint, limit or submitted order is not an achieved entry price.

## 6. Run on the selected computer and survive restarts

Use this Mac initially. Settings selects the execution computer and the TWS/Gateway address or Web API endpoint, so the setup can move later.

Only one execution worker may control the account at a time. A direct database connection holds a session lock, and each write verifies the selected host and Settings revision. The private database journal is canonical; a local file provides a backup. Moving computers preserves this journal and reconciles existing orders before proceeding. Broker passwords/tokens stay on the execution computer.

TWS supports a daily automatic restart; configure it in TWS’s Lock and Exit settings. The worker reconnects on subsequent cycles, reloads its journal and reconciles orders/fills before acting. Weekly manual authentication is still normally required after IB invalidates tokens on Sunday at01:00 ET. Expected restart time/time zone and recovery status is visible in PolyTheta. An outage never authorizes a duplicate order.

Sources: [IB auto-restart requirements](https://www.ibkrguides.com/traderworkstation/auto-restart-considerations.htm), [IB exact-strike IV field7633](https://www.interactivebrokers.com/docs/web-api/v1/endpoints/market-data/market-data-fields), [Cboe VIX explanation](https://www.cboe.com/tradable-products/volatility-trading).
