# IB connection and operating guide

The website and apps display a database snapshot. The local Node worker owns broker reads and orders. Claude/other language models do not submit trades. Both adapters use the same policy, durable intent journal, matching account fingerprint, exact IB contract ID and order-reference reconciliation.

## Local configuration

Store values on the trading computer in `.env.local`, never in Git, the website, a plist, chat or email. Existing database and mobile API configuration remains in use.

| Variable | Purpose |
|---|---|
| `IBKR_ACCOUNT_ID` | Exact account to access. A `DU…` paper account is refused unless `IBKR_ALLOW_PAPER=true` |
| `IBKR_ALLOW_PAPER` | `true` permits a paper (`DU…`) account. Paper fills enter the ledger as broker `IBKR paper`, and the journal records its mode so a paper journal can never drive the live account |
| `IBKR_TWS_PORT` | Overrides the Settings socket port locally; paper defaults are Gateway 4002 / TWS 7497 (live 4001 / 7496) |
| `POLYTHETA_MODEL_EQUITY` | Optional modeling override for basket selection. Ignored whenever the worker has published IB equity |
| `IBKR_TWS_TIME_ZONE` | Set UTC only when TWS API execution timestamps are configured as UTC |
| `IBKR_ACCESS_TOKEN` | Corporate service token, if its approved authentication flow uses a bearer token |
| `IBKR_LOCAL_GATEWAY_INSECURE` | Optional true only for a local gateway's self-signed certificate; remote TLS is always verified |
| `POLYTHETA_EXECUTION_ENABLED` | Operator-controlled activation; absent/false means broker reads only |
| `IBKR_WORKER_DATABASE_URL` | Optional direct PostgreSQL connection for the singleton worker lock; the default Neon URL is converted to its direct endpoint |

A corporate account does not by itself establish an approved unattended Web API authentication flow. The Web API adapter supports an already authenticated gateway/service; OAuth credentials, token renewal and corporate entitlements must be provisioned with IB for the chosen connection. It does not bypass 2FA. A gateway on this Mac is unavailable to Netlify, so the worker runs locally and synchronizes results to the website database.

1. Sign in to the selected live gateway. Configure its API access and the dedicated client ID. Keep TWS in read-only mode while checking the connection.
2. Run `npm run ib:check -- --select-this-host` on this Mac to register it and select it if no execution computer is selected yet. Settings lets you change the computer, choose TWS/Gateway or Web API, and set the socket host/port/client ID or HTTPS endpoint. Gateway commonly uses live port 4001; TWS commonly uses 7496. Run `npm run ib:check` after setup. This reads account state and publishes diagnostics; it never submits orders or imports ledger fills.
3. Verify the exact account, real-time US option/underlying subscriptions, standard contract resolution and IB margin preview. A successful TCP connection alone does not prove these are available.
4. Review allocation, maximum trades, calls/puts, exclusions, OTM minimums, quote/credit thresholds and the entry pause setting. Use [the rules](trading_rules.md).
5. Install the local schedules with `npm run ib:install`. This generates paths for the current computer, backs up older launchd files and installs the broker cycle every 30 seconds plus the preparation/finalization scheduler every 60 seconds. It does not change activation. An already running cycle is protected from overlap, so slow reads can lengthen the actual monitoring interval.
6. Live order activation is an owner action on the trading computer. The review did not activate execution or submit any order. When active, `npm run ib:run` performs one cycle. The computer must stay awake with IB authenticated. Saving Settings alone does not activate trading.

## Account equity drives sizing

Every worker cycle, including `npm run ib:check`, publishes IB NetLiquidation (plus available funds, excess liquidity and cash) to the `broker_equity` setting and to `runtime/ib-equity.json`. The weekly basket selects and sizes against that value (`model_equity`, with `model_equity_source` and `model_equity_observed_at` recorded in the proposal); the execution service then budgets entries from a fresh NetLiquidation read at entry time. There is no separate "account size" setting: fund the account and both the model and the orders follow it.

Once an execution computer is selected, the basket refuses to build without an equity snapshot newer than seven days — sign in to IB and run `npm run ib:check` before Monday. With no execution computer selected the historical $1,000,000 modeling basis (or `POLYTHETA_MODEL_EQUITY`) is used so the website track record keeps its scale.

## Reliability and reconciliation

- Never delete the execution journal to clear an error. The canonical ownership, loss baseline, trigger and order record is the private `ib_execution_journal` database setting, available only to the worker. `runtime/ib-execution.json` is the local backup. Neither is a public mobile/settings response. Missing/corrupted state cannot safely adopt arbitrary IB positions.
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

## Review status, September 10, 2026

The read-only local check reports `IBKR_ACCOUNT_ID is not configured on this Mac`. The standard live TWS/Gateway ports had no listener. Therefore authentication, quote entitlements and account-level contract/margin read checks remain unverified. No live orders have been submitted. Choose the execution host and complete its IB setup before using live controls.
