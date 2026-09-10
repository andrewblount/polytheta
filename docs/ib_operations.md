# IB connection and operating guide

The website and apps display a database snapshot. The local Node worker owns broker reads and orders. Claude/other language models do not submit trades. Both adapters use the same policy, durable intent journal, matching account fingerprint, exact IB contract ID and order-reference reconciliation.

## Local configuration

Store values on the trading computer in `.env.local`, never in Git, the website, a plist, chat or email. Existing database and mobile API configuration remains in use.

| Variable | Purpose |
|---|---|
| `IBKR_ACCOUNT_ID` | Exact live account to access; no paper account |
| `IBKR_TWS_HOST` | TWS / IB Gateway host, default 127.0.0.1 |
| `IBKR_TWS_PORT` | Live IB Gateway defaults to 4001; live TWS commonly uses 7496 |
| `IBKR_TWS_CLIENT_ID` | Dedicated persistent API client ID, default 96 |
| `IBKR_TWS_TIME_ZONE` | Set UTC only when TWS API execution timestamps are configured as UTC |
| `IBKR_WEB_API_URL` | Authenticated HTTPS Client Portal gateway or approved corporate Web API endpoint |
| `IBKR_ACCESS_TOKEN` | Corporate service token, if its approved authentication flow uses a bearer token |
| `IBKR_LOCAL_GATEWAY_INSECURE` | Optional true only for a local gateway's self-signed certificate; remote TLS is always verified |
| `POLYTHETA_EXECUTION_ENABLED` | Operator-controlled activation; absent/false means broker reads only |

A corporate account does not by itself establish an approved unattended Web API authentication flow. The Web API adapter supports an already authenticated gateway/service; OAuth credentials, token renewal and corporate entitlements must be provisioned with IB for the chosen connection. It does not bypass 2FA. A gateway on this Mac is unavailable to Netlify, so the worker runs locally and synchronizes results to the website database.

1. Sign in to the selected live gateway. Configure its API access and the dedicated client ID. Keep TWS in read-only mode while checking the connection.
2. Select TWS or Web API in PolyTheta Settings. Run `npm run ib:check` on the trading computer. This reads account state and publishes diagnostics; it never submits orders or imports ledger fills.
3. Verify the exact account, real-time US option/underlying subscriptions, standard contract resolution and IB margin preview. A successful TCP connection alone does not prove these are available.
4. Review allocation, maximum trades, calls/puts, exclusions, OTM minimums, quote/credit thresholds and the entry pause setting. Use [the rules](trading_rules.md).
5. Live order activation is an owner action on the trading computer. The review did not activate execution or submit any order. When active, `npm run ib:run` performs one cycle; the launchd template runs it every minute. The computer must stay awake with IB authenticated. Restart/reconnect preserves `runtime/ib-execution.json`.

## Reliability and reconciliation

- Never delete the execution journal to clear an error. It is the ownership and deduplication record. Back it up securely. Missing/corrupted state cannot safely adopt arbitrary IB positions.
- Only orders/fills carrying known PolyTheta references are owned. Pre-existing manually entered PolyTheta trades require explicit reconciliation against broker executions before adoption; a ticker match alone is insufficient.
- Read requests have timeouts and bounded retries, and scheduled cycles continue recovery. Authentication failures require sign-in. Order writes are never blindly retried after a timeout.
- The journal is persisted before network submission. Uncertain acknowledgments block new entries. Confirmed partial fills are not treated as full fills. Each exit closes at most the remaining owned short quantity.
- Exit-all requests also cancel working entries and include newly filled PolyTheta trades discovered during worker reconciliation. Foreign working orders on the same option block a competing close and require review at IB.
- A debit-ceiling breach is shown as intervention required. NOW means process promptly, not an unconditional market order or guaranteed fill. Existing triggered exits survive source outages and closed sessions.
- Normal option expiry and assignment can lack a buy-to-close fill. These remain incomplete until supported by an IB activity statement; do not book zero settlement solely because a position disappears. Any resulting stock position also requires attribution before PolyTheta may act on it.
- Quotes and account valuations are distinct from fills. IB marks support open P/L; final return accounting requires fills, commissions and settled activity. The current code does not import historical Flex statements automatically.

## Review status, September 9, 2026

The read-only local check reports `IBKR_ACCOUNT_ID is not configured on this Mac`. The standard live TWS/Gateway ports had no listener. Therefore authentication, quote entitlements and account-level contract/margin read checks remain unverified. No live orders have been submitted. Choose the execution host and complete its IB setup before using live controls.
