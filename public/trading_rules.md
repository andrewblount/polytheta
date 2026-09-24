# PolyTheta — entry, exit and allocation rules

Updated September 10, 2026. Owner-approved policy: **live IB account, news exits plus a per-ticker maximum loss exception**. The loss exception supplements policy v3; GSRS and ordinary news rules are unchanged. Live IB authentication and activation remain separate operating steps.

## Allocation

- Settings choose **total allocation as a percentage of IB account equity**, maximum trades, and call/put percentages. Calls default to 100%, puts to 0%; the maximum defaults to 8.
- Percentages determine the **number of trades**. A 75/25 split permits 3 calls + 1 put or 6 calls + 2 puts. The largest qualifying basket within the maximum is selected. If fewer names qualify, use a smaller basket with the same split. An impossible split produces no basket.
- Divide the available allocation **equally across those trades**, then round contract counts down. Unused amounts remain unallocated; they are not redistributed after a fill or loss.
- New entries use at most equity, positive cash, available funds and excess liquidity. Backing per contract is 100 × the greater of strike and current stock price. IB's order preview must also approve the margin requirement within the trade's allocation.
- The configurable margin reserve ceiling defaults to **4× equity**. The code monitors IB-reported gross position value divided by equity. Exceeding the configured ceiling blocks new entries and flags review; it never causes a price-based exit. The ceiling does not multiply entry size, or promise 4× buying power. IB sets the actual requirement. A naked call still has unlimited potential loss.
- Existing entry risk reductions apply uniformly to the basket to preserve equal allocation: an elevated frenzy signal halves the basket allocation; GSRS 3–5 halves it when puts are included. Both together quarter it. GSRS ≥5 prohibits new puts.

## Entry

- The editable do-not-trade list defaults to **TSLA and SPCX (SpaceX)**. SPACEX is accepted as an alias; the SpaceX company name is also matched. Removing a symbol permits future screening. Adding one blocks new entries and cancels unfilled entries; existing positions can still close normally.
- **Per-trade minimum OTM** is keyed by ticker, call/put and exact expiry. For a call, OTM% = 100 × (strike − stock price) / stock price. For a put, OTM% = 100 × (stock price − strike) / stock price. Select only listed strikes at or beyond the minimum, keeping the delta and ATR requirements. There is no single hard-coded OTM percentage. Without an override, the existing selection rules determine the distance. Set overrides before a basket is built; changes never alter an existing holding. If a published strike no longer satisfies a changed minimum or a moving stock price, its entry is blocked.

- Choose **Friday close** or **Monday morning** in Settings. Friday mode enters during the final five minutes of the preceding week's final session, targeting the following week's expiry. If Friday is closed, use the preceding session and its actual close, including early closes. Monday mode enters in the first session of the basket week, default 09:45–10:30 ET, configurable within 09:30–12:00. A Monday holiday moves this to Tuesday. Verify the exact weekly expiry at IB.
- Full preparation starts 90 minutes before the preceding session's close, configurable 30–240. Final candidate refresh starts 10 minutes before the entry window, configurable 5–20. Normal Friday mode: preparation 14:30, final refresh 15:45, entry 15:55–16:00 ET. The scheduler checks every minute and retries while the window allows. A dated Friday preparation can support Monday finalization. No late-week catch-up entry or silent Friday-to-Monday switch is allowed.
- Preparation and final publication are separate artifacts. Final checks include current quotes, same-contract IV, earnings, news, allocation and strike rules. The published basket and its delivery receipt share one week and generation identity. Delivery-only retries preserve the original prices and clearly label delayed mail.
- Screen single stocks with weekly options, prices $8–$100, average stock volume ≥1.5 million, and the strategy's high-volatility screen. Require OTM side volume ≥500, a positive bid, modeled credit ≥$0.10, spread ≤$0.15 and absolute delta 0.15–0.20. Calls need ≥1 ATR strike buffer; puts ≥2 ATR.
- Exclude conflicting or unknown earnings dates, active call-side buybacks, triggered or unavailable news scans, extreme upward frenzy, duplicate names and more than two names in one family. Thesis signals remain explicitly known/pass/fail/unknown; the original three-of-five rule is enforced only where enough signals are known.
- Before an order, resolve the exact standard USD, 100-share IB contract. Require fresh **real-time IB bid/ask, size, underlying price and delta**. Yahoo is a research fallback, never an execution-price fallback. Recheck strike buffer and adverse drift: 4% or 0.5 ATR invalidates the entry.
- Enter with a DAY sell limit near midpoint. The minimum credit defaults to 90% of the time/underlying/IV-adjusted expected credit, never below $0.10, rounded to a valid conservative tick. Reprice at most once per minute within that floor. Cancel an unfilled entry after the configurable timeout (default five minutes) or when its configured entry window ends. DAY orders require the worker to be connected for cancellation at the end of a Monday morning window; a worker outage can leave one working until the broker's session end. Partial fills remain recorded; there is no automatic second entry.

## Exit

- **Exit NOW** closes the selected PolyTheta trade. **Exit all NOW** closes only PolyTheta trades and pauses new entries. These are explicit owner overrides of the normal news and loss-limit policy. Web, iPhone and Watch confirmations are tied to the displayed IB account. Existing pending exits are reused; they are not doubled. The worker reconciles current positions again, including fills that arrived after the screen refreshed.
- Trade screens show IB-derived **PolyTheta holdings and P/L only**. Other account positions and their P/L are excluded. Account equity is used for allocation, account-level capacity checks and the per-ticker loss baseline. The refresh timestamp, execution activation state, incomplete fees and blocked exits are visible. A stale or disconnected snapshot cannot authorize a new exit request.
- The Watch relays refreshes and confirmed exit requests through the paired iPhone. The iPhone must be reachable; the execution Mac must also be running and connected to IB. An exit request is queued work, not a fill receipt.

- Normally **hold to expiry**. There is no early profit target or averaging down. Automatic early exits have two causes: qualifying news or the maximum loss rule below.
- News exits require credible company-specific news: acquisition/takeover risk for a short call, or a serious downside event for a short put. A keyword match alone does not authorize an exit. The code checks issuer identity, publication time, source and, for calls, whether the company is the target rather than the buyer.
- The execution service scans Yahoo-distributed news for its own positions each cycle. Recognized primary/wire sources qualify for automatic decisions; other matches require review. This is limited news coverage, not a claim to see every rumor or filing. Apify is not required by the current data paths and has not been subscribed to or activated.
- Cancel any remaining entry quantity first. After broker reconciliation, buy to close only the owned short quantity. The initial exit limit is the current ask; repricing stays under a configurable ceiling (default 1.5× the initial ask). Unfilled or blocked exits require attention at IB. A limit order cannot guarantee an immediate fill.
- Events detected while the exchange is closed remain queued for its next session. Broker session failures retry on later runs. Unknown order results block new entries until reconciled, rather than risking a duplicate.
- Expiry modeling uses the actual expiry-session closing stock price and intrinsic value. Assignment, exercise, commissions and stock exposure must be reconciled at IB; an expiry model is not proof a live position is closed.

## Maximum loss per ticker

- Settings includes **Maximum loss per ticker (% of account)**, initially **20%**, configurable from 0.1% to 100%.
- Record actual IB account equity (Net Liquidation Value) immediately before entering that ticker. Freeze that baseline; later equity changes do not move it. This uses total account equity even though the positions and losses evaluated are PolyTheta-only.
- `loss threshold dollars = account equity before entry × configured percentage / 100`.
- Monitor that ticker's combined PolyTheta option exposure using recorded entry fills, closing fills, known commissions and fresh IB quotes for the remaining short contracts. Gains on another ticker or positions outside PolyTheta do not offset this ticker's loss.
- Each ticker is evaluated independently. Losses across several tickers can add up to more than the configured percentage of account equity.
- Example: equity before entry is **$1,000,000**. At the default 20%, the ticker's loss trigger is **$200,000**, regardless of the later account balance.
- This is a **running-code check**, not a stop order placed at entry. Once reached, persist the trigger, cancel working entries, reconcile fills and close only that ticker's remaining PolyTheta contracts. No automatic re-entry into the stopped allocation. Other tickers retain their own rules.
- A triggered loss exit uses a marketable limit based on the fresh IB ask and keeps updating that limit as valid quotes change; it does not remain capped at 1.5 times the first ask. News/manual exits retain their existing debit ceiling. A triggered loss exit stays triggered after a recovery, restart or overnight closure.
- The worker must be running, authenticated and receiving usable quotes. Missing historical equity or unreconciled positions are shown as unavailable and require reconciliation; current equity is never invented as a historical baseline. Gaps, closed markets, connection outages and execution slippage can carry losses beyond the threshold. **20% is a trigger, not a guaranteed maximum realized loss.**

## GSRS calculation — why it can look stable

GSRS is the **Global Systemic Risk Score**, not a probability of loss. Each component below is clipped to 0–10:

| Component | Component calculation | Weight |
|---|---|---:|
| VIX | (VIX − 10) / 4 + 0.5 × max(0, VIX − previous VIX close) | 40% |
| SKEW | (SKEW − 100) / 10 | 20% |
| High-yield spread | 5 × (HY OAS − 1.5) / (3.59 − 1.5); OAS in percentage points | 20% |
| MOVE | (MOVE − 50) / 10 | 10% |
| Total put/call ratio | 7 × (1 − P/C) | 10% |

**GSRS = weighted sum, rounded to two decimal places.** The 3.59 OAS reference is a fixed parameter, not a freshly calculated rolling average. The put/call term is contrarian: a lower ratio increases this component; a ratio ≥1 contributes zero.

Example from the August 31 basket: 0.4×1.74 + 0.2×4.98 + 0.2×2.63 + 0.1×2.10 + 0.1×1.12 ≈ **2.54**.

The basket displays **GSRS at entry**, so that number is fixed for its week. The sampled July–August baskets ranged from 2.18 to 3.04. Weighted normalization dampens changes, and daily FRED/Cboe publications move less frequently than quotes. Older code could also carry fixed macro defaults after an import failure; the corrected importer blocks that fallback and records source dates. The formula itself has not been retuned.

## Modeled versus actual returns

Historical modeled results used midpoint entries and expiry outcomes. New entry estimates adjust the dated reference premium for actual remaining calendar time, the current underlying price and exact-option IV (or a labeled VIX-ratio approximation). The full formula and timing examples are in [entry timing and pricing](entry_timing_and_pricing.md). Actual open P/L uses PolyTheta entry fills and IB position marks; realized P/L uses matched buy-to-close fills. Confirmed commissions are shown separately. Missing fees are not treated as zero final cost. Expiration or assignment without a matched closing fill remains flagged for statement reconciliation; disappearance from IB holdings is not proof of a zero-cost settlement. Unreconciled past expirations do not conceal current open P/L. A broker quote—even a real-time one—is not a fill. A $0.02 worse credit on 100 contracts reduces premium by $200 before commissions. Legacy modeled results retain their historical sizing assumptions; compare them separately from the new cash-backed equal-allocation policy.

Operational status: both IB adapters and the execution service are implemented, but live account authentication, entitlements and live order acceptance must be verified separately. Saving Settings does not activate live trading.

SpaceX ticker source: [company announcement](https://content.spacex.com/cms-assets/FINAL_Documents%20and%20Updates/6.4.26_SpaceX_Announces_IPO_US.pdf).

Sources: [NYSE calendar](https://www.nyse.com/trade/hours-calendars), [IB market-data requirements](https://www.interactivebrokers.com/docs/general/market-data-subscriptions/introduction), [IB Web API snapshots](https://www.interactivebrokers.com/docs/web-api/trading/market-data/top-of-book-snapshots), [IB margin previews](https://www.interactivebrokers.com/docs/web-api/v1/endpoints/orders/preview-order-what-if-order).
