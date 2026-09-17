# IB connection and operating guide

The website and apps display a database snapshot. The local Node worker owns broker reads and orders. Claude/other language models do not submit trades. Both adapters use the same policy, durable intent journal, matching account fingerprint, exact IB contract ID and order-reference reconciliation.

## Local configuration

Store values on the trading computer in `.env.local`, never in Git, the website, a plist, chat or email. Existing database and mobile API configuration remains in use.

| Variable | Purpose |
|---|---|
| `IBKR_ACCOUNT_ID` | Exact live account to access when Settings selects Live trading |
| `IBKR_PAPER_ACCOUNT_ID` | Optional exact paper account (`DU…`). When absent, PolyTheta discovers a single authorized paper account from the signed-in session. Multiple paper accounts require this value |
| Settings → API port | Paper defaults: Gateway 4002 / TWS 7497. Live defaults: Gateway 4001 / TWS 7496. Match the port configured in Gateway; the worker uses the saved Settings port |
| `POLYTHETA_MODEL_EQUITY` | Optional modeling override for basket selection. Ignored whenever the worker has published IB equity |
| `IBKR_TWS_TIME_ZONE` | Set UTC only when TWS API execution timestamps are configured as UTC |
| `IBKR_ACCESS_TOKEN` | Corporate service token, if its approved authentication flow uses a bearer token |
| `IBKR_LOCAL_GATEWAY_INSECURE` | Optional true only for a local gateway's self-signed certificate; remote TLS is always verified |
| `POLYTHETA_EXECUTION_ENABLED` | Operator-controlled live activation; ignored in paper mode. Absent/false means broker reads only |
| `POLYTHETA_PAPER_EXECUTION_ENABLED` | Separate paper-order activation; ignored in live mode. Absent/false means paper reads only |
| `POLYTHETA_PAPER_ENTRY_WEEK` | Optional Monday date limiting new paper entries to one basket week. Existing paper positions remain monitored and eligible for exits after that week. Ignored in live mode |
| `IBKR_MARKET_DATA_CLIENT_ID` | Dedicated read client for basket finalization and `ib:data`; defaults to 97 and must differ from the execution client (normally 96) |
| `IBKR_WORKER_DATABASE_URL` | Optional direct PostgreSQL connection for the singleton worker lock; the default Neon URL is converted to its direct endpoint |

A corporate account does not by itself establish an approved unattended Web API authentication flow. The Web API adapter supports an already authenticated gateway/service; OAuth credentials, token renewal and corporate entitlements must be provisioned with IB for the chosen connection. It does not bypass 2FA. A gateway on this Mac is unavailable to Netlify, so the worker runs locally and synchronizes results to the website database.

1. Sign in to Gateway using your existing IB login and select the same Paper Trading or Live Trading mode as PolyTheta Settings. Configure its API access and the dedicated client ID. Keep TWS in read-only mode while checking the connection.
2. Run `npm run ib:check -- --select-this-host` on this Mac to register it and select it if no execution computer is selected yet. Settings lets you change the computer, choose TWS/Gateway or Web API, and set the socket host/port/client ID or HTTPS endpoint. Gateway commonly uses live port 4001; TWS commonly uses 7496. Run `npm run ib:check` after setup. This reads account state and publishes diagnostics; it never submits orders or imports ledger fills.
3. Verify the exact account, real-time US option/underlying subscriptions, standard contract resolution and IB margin preview. A successful TCP connection alone does not prove these are available.
4. Review allocation, maximum trades, calls/puts, exclusions, OTM minimums, quote/credit thresholds and the entry pause setting. Use [the rules](trading_rules.md).
5. Install the local schedules with `npm run ib:install`. This generates paths for the current computer, backs up older launchd files and installs the broker cycle every 30 seconds plus the preparation/finalization scheduler every 60 seconds. It does not change activation. An already running cycle is protected from overlap, so slow reads can lengthen the actual monitoring interval.
6. Live order activation is an owner action on the trading computer. The review did not activate execution or submit any order. When active, `npm run ib:run` performs one cycle. The computer must stay awake with IB authenticated. Saving Settings alone does not activate trading.

## Paper testing before live trading

1. In PolyTheta Settings → Interactive Brokers, select **Paper trading · simulated money** and save. Standard ports switch automatically (Gateway 4002 / TWS 7497); custom ports are preserved. Changing account mode pauses entries. Only the selected account is monitored.
2. On the selected execution computer, sign in to **IB Gateway → Paper Trading** using your existing IB credentials. Store the login in Apple Passwords and enter it in Gateway, not PolyTheta, `.env.local`, chat or Git. Authentication stays inside IB, including any required verification.
3. Enable socket API access and match the API port. Keep the API read-only for the initial check. Run `npm run ib:check` (or `npm run ib:check -- --select-this-host` if no computer is selected). A single authorized DU account is detected automatically. If several exist, set `IBKR_PAPER_ACCOUNT_ID` locally to the exact intended account. The live `IBKR_ACCOUNT_ID` is never reused for paper.
4. Confirm the Settings status says **IB paper account connected**. The connection check submits no orders. The broker holdings screen labels the account as paper and shows simulated fills/marks when available. Paper fills never enter the actual-trade ledger.
5. To authorize automated paper orders separately, the operator sets `POLYTHETA_PAPER_EXECUTION_ENABLED=true` locally, disables Gateway API read-only and unpauses entries after checking trading rules and the entry schedule. `POLYTHETA_EXECUTION_ENABLED` cannot activate paper orders, and paper activation cannot activate live orders. Market-data, reconciliation and entry-window checks still apply.

Switching back to live requires selecting Live trading, signing into the live Gateway session and checking the exact configured live account. Paper balances cannot size live baskets; run a fresh connection check after switching. The old `IBKR_ALLOW_PAPER` flag does not override the selected account mode.

## Subscribed IB market data

With an execution computer selected, finalization obtains each exact option's real-time bid, ask, IV, Greeks and underlying price from the selected IB session. IB contract IDs, source and receipt timestamps are recorded in the proposal. Invalid, delayed, frozen or stale IB quotes block publication, with no Yahoo option-quote fallback. Execution takes another fresh IB quote and margin preview before each order. Broad universe research, historical volatility, earnings, news and macro inputs retain their existing sources and checks.

The subscriptions belong to the IB username. In Client Portal → Settings → Paper Trading Account, confirm real-time data sharing is enabled for the subscribed live username; API Market Data Acknowledgement must also be complete. Simultaneous sessions can prevent shared data from reaching paper. See [IBKR market-data requirements](https://www.interactivebrokers.com/campus/ibkr-api-page/market-data-subscriptions/) and [paper data sharing](https://www.interactivebrokers.eu/campus/trading-lessons/request-paper-trading-account/).

`npm run ib:check` verifies account connectivity. During US market hours, probe an available exact option using `npm run ib:data -- --ticker SYMBOL --strike PRICE --expiry YYYY-MM-DD --side call`. This command only reads; it never previews or submits an order. It checks the underlying and option data against the entry quote limits, and saves the latest result to private `runtime/ib-market-data-check.json`. A successful account connection alone does not establish subscription readiness. Use a liquid near-the-money contract to check entitlements; this probe does not select a basket trade.

## Account equity drives sizing

Every worker cycle, including `npm run ib:check`, publishes IB NetLiquidation (plus available funds, excess liquidity and cash) to the `broker_equity` setting and to `runtime/ib-equity.json`. The weekly basket selects and sizes against that value (`model_equity`, with `model_equity_source` and `model_equity_observed_at` recorded in the proposal); the execution service then budgets entries from a fresh NetLiquidation read at entry time. There is no separate "account size" setting: fund the account and both the model and the orders follow it.

Once an execution computer is selected, the basket refuses to build without an equity snapshot newer than seven days — sign in to IB and run `npm run ib:check` before Monday. With no execution computer selected the historical $1,000,000 modeling basis (or `POLYTHETA_MODEL_EQUITY`) is used so the website track record keeps its scale.

## Reliability and reconciliation

- Never delete the execution journal to clear an error. The canonical ownership, loss baseline, trigger and order record is the private `ib_execution_journal:paper` or `ib_execution_journal:live` database setting, available only to the worker. `runtime/ib-execution-paper.json` and `runtime/ib-execution-live.json` are the local backups. These are never public mobile/settings responses. Legacy journals are adopted only for their matching account mode and are preserved during migration. Missing/corrupted state cannot safely adopt arbitrary IB positions.
- Each computer registers a stable identity outside Dropbox in `~/.polytheta/worker.json`. Only the selected computer may connect and publish broker state. A direct PostgreSQL session holds the global execution lock; loss of that connection invalidates the worker. Broker writes and database snapshots are fenced against host or Settings changes. To move, register the new computer, select it in Settings, provision its local credentials, reconcile with `ib:check`, then install its schedules. Do not copy a host identity to another machine.
- Only orders/fills carrying known PolyTheta references are owned. Pre-existing manually entered PolyTheta trades require explicit reconciliation against broker executions before adoption; a ticker match alone is insufficient.
- Read requests have timeouts and bounded retries, and scheduled cycles continue recovery. Authentication failures require sign-in. Order writes are never blindly retried after a timeout.
- The journal is persisted before network submission. Uncertain acknowledgments block new entries. Confirmed partial fills are not treated as full fills. Each exit closes at most the remaining owned short quantity.
- Exit-all requests also cancel working entries and include newly filled PolyTheta trades discovered during worker reconciliation. Foreign working orders on the same option block a competing close and require review at IB.
- A news/manual debit-ceiling breach is shown as intervention required. A loss-triggered exit instead tracks the fresh ask with a marketable limit each cycle, so the initial ask ceiling cannot strand it as a loss grows. NOW means process promptly, not an unconditional market order or guaranteed fill. Existing triggered exits survive source outages and closed sessions.
- The maximum loss rule is per ticker, default 20% of total account equity recorded immediately before entry. It covers only that ticker's PolyTheta exposure, freezes the equity baseline and persists once triggered. No stop order is placed at entry. Missing data, a disconnected worker, closed markets and gaps can delay action or exceed the threshold. The screen exposes the baseline, threshold, measured loss and monitoring status.
- Normal option expiry and assignment can lack a buy-to-close fill. These remain incomplete until supported by an IB activity statement; do not book zero settlement solely because a position disappears. Any resulting stock position also requires attribution before PolyTheta may act on it.
- Quotes and account valuations are distinct from fills. IB marks support open P/L; final return accounting requires fills, commissions and settled activity. The current code does not import historical Flex statements automatically.

## TWS restart and recovery

Set the actual daily Auto Restart time in TWS's Lock and Exit settings. PolyTheta's expected restart time, time zone and grace interval describe that schedule and label temporary reconnect failures; they do not change TWS settings or bypass authentication. Defaults are 23:45 America/New_York and a ten-minute grace interval. The worker retries on later cycles and reconciles the durable journal before any further order.

IB's current guidance still requires periodic manual authentication; auto-restart tokens are invalidated weekly on Sunday at 01:00 ET. The computer must stay awake and reachable. See [IB auto-restart considerations](https://www.ibkrguides.com/traderworkstation/auto-restart-considerations.htm).

## Paper run, September 21–25, 2026

The owner requested the September 21 basket use Paper Trading after subscribing to IB market data and API access. This Mac is selected, Gateway port is 4002, paper execution is enabled, and `POLYTHETA_PAPER_ENTRY_WEEK=2026-09-21`; live activation is false. Entries are unpaused but remain subject to connectivity, account-mode, current-basket, data and margin checks. The configured entry window is September 21, 09:45–10:30 ET, with expiry September 25. Research preparation starts September 18 at 14:30 ET; finalization starts September 21 at 09:35 ET.

At setup, Gateway was open with Paper Trading selected and awaiting the owner's login; account connectivity returned IB error 502. Subscription sharing, account equity, live quotes and margin remain unverified. No basket has been finalized for September 21 and no orders were submitted during setup. The installed workers retry automatically; successful authentication and valid data are required before the scheduled run. See the current project brief for subsequent verification.
