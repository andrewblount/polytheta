# Polytheta

Premium members-only options basket platform built with Next.js App Router, Tailwind CSS, Netlify Identity, Netlify DB (PostgreSQL), Drizzle ORM, and scheduled market-data refreshes.

## Stack

- Next.js App Router + TypeScript
- Tailwind CSS v4
- Accessible custom component layer with Radix primitives
- Netlify Identity for auth
- Neon PostgreSQL (via @netlify/neon)
- Drizzle ORM + generated SQL migrations
- Yahoo Finance-compatible provider abstraction on the server
- Netlify Scheduled Function for recurring refreshes

## Product Areas

- Public site: home, methodology, preview, about, FAQ, contact, privacy, terms
- Member app: dashboard, current basket, archive, basket detail, analytics, position detail, settings
- Admin app: dashboard, basket list/editor, user management, manual overrides, sync status

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.example .env.local
```

3. If you want real Netlify auth + database locally, provision a Neon database and configure `NETLIFY_DATABASE_URL`:

```bash
# Set up Neon database and configure NETLIFY_DATABASE_URL in .env.local
npm run netlify:dev
```

4. For UI-only local development without live Netlify Identity, keep demo mode enabled:

```bash
POLYTHETA_DEMO_MODE=true
POLYTHETA_DEMO_ROLE=admin
```

5. Seed the database after `NETLIFY_DATABASE_URL` is available:

```bash
npm run db:seed
```

## Database

Schema lives in [src/db/schema.ts](./src/db/schema.ts).

Useful commands:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

Generated migration output is in [src/db/migrations](./src/db/migrations).

## Netlify Deployment

1. Create/connect the Netlify site.
2. Enable Identity for the site.
3. Provision a Neon database and set `NETLIFY_DATABASE_URL` in Netlify environment variables.
4. Set `INTERNAL_SYNC_TOKEN` in Netlify environment variables.
5. Set `ACCESS_REQUEST_NOTIFY_EMAIL=ablount@bluecielo.com`.
6. If you want access-request emails delivered, also configure `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`.
7. Deploy. Netlify auto-detects Next.js App Router.
8. Run the seed script once against the provisioned database.

Scheduled refresh is defined in [netlify/functions/market-sync.mts](./netlify/functions/market-sync.mts) with an hourly cadence.

## Market Data

The server-side provider interface lives in [src/server/market/provider.ts](./src/server/market/provider.ts).

Current default implementation:

- Yahoo-compatible quote, chart, and option-chain access through `yahoo-finance2`
- Exact option marks when available
- Black-Scholes-style fallback estimate when exact contract marks are unavailable
- Confidence labels: `Actual`, `Estimated`, `Expiry-Resolved`

## Seed Data

The seed includes:

- One current published basket
- One archived historical basket
- Call-side and put-side positions
- Order blocks, alerts, hard stops, profit targets
- Historical performance snapshots
- Demo admin/member profiles
- Sync job history

Seed source lives in [src/lib/demo-data.ts](./src/lib/demo-data.ts).

## Auth Notes

- Member/admin routes are guarded server-side with `requireAppUser`
- First access routes users through the risk acknowledgement page
- Admin role/status is stored in PostgreSQL and synced to Netlify Identity role updates when the Netlify runtime is available
- For real local auth flows, prefer `npm run netlify:dev` over raw `next dev`

## Verification

These checks pass in this workspace:

```bash
npm run lint
npm run build
```

## Live IB service and trading rules

> **⚠️ ALPHA/UNVERIFIED:** The IB integration code is implemented but has **never connected to a live account or executed a real order**. Treat as prototype requiring extensive testing before any live use. See [IB operations guide](docs/ib_operations.md) for current status.

- [Entry, exit, allocation and exact GSRS formula](docs/trading_rules.md), also visible at `/trading-rules`.
- [IB configuration, execution and reconciliation guide](docs/ib_operations.md).
- [Friday/Monday timing and the entry-price calculation](docs/entry_timing_and_pricing.md). Friday holidays use the preceding session and actual early close. Preparation and final publication are separate; final checks run before the configured entry window.
- Settings selects the execution computer, IB connection, entry window and maximum loss per ticker (default 20% of account equity recorded before entry). The running worker monitors the loss; it does not place a standing stop at entry.
- `/app/live` and the iOS / paired Watch app show only attributable PolyTheta positions, actual entry fills and IB marks. Owner-confirmed exits are queued for the broker worker; a queued request is not a confirmed fill.
- `npm test` exercises the exchange calendar, source recovery, allocation, strike minimums, news relevance, broker adapters and order-state safety with synthetic data. It never connects to a broker or sends email.
- `npm run ib:check` is a read-only broker check. Settings changes and deployment do not activate orders.
- `npm run ib:check -- --select-this-host` registers this computer and selects it only if no host is selected. `npm run ib:install` installs the local schedules using this computer's paths. The private database journal and direct PostgreSQL execution lock preserve ownership and prevent overlapping workers when moving computers.
