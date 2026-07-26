#!/usr/bin/env node
// Backfill entry + expiry-resolved snapshots for baskets whose options have
// already expired.
//
// The hourly market sync only walks *published* baskets, and the site drops any
// position with zero performance_snapshots. That left every archived basket
// rendering empty — which is exactly the track record you want to look at.
// Settled positions never change, so this runs once per basket rather than
// hourly.
//
//   node scripts/backfill_settled.mjs            # all archived baskets missing snapshots
//   node scripts/backfill_settled.mjs --all      # include ones already backfilled
//   node scripts/backfill_settled.mjs --dry-run
//
// Requires NETLIFY_DATABASE_URL or DATABASE_URL.

import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import YahooFinanceMod from 'yahoo-finance2';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env.local'));
} catch {
  /* optional */
}

const YahooFinance = YahooFinanceMod.default ?? YahooFinanceMod;
const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

const args = {
  all: process.argv.includes('--all'),
  dryRun: process.argv.includes('--dry-run'),
};

const url =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;
if (!url) {
  console.error('Set NETLIFY_DATABASE_URL (or DATABASE_URL).');
  process.exit(1);
}
const sql = neon(url);

const priceCache = new Map();

// Last close at or before `onOrBefore`. Yahoo sometimes returns a null-close
// bar for the most recent session, so walk backwards to the last real print.
async function closeOnOrBefore(ticker, onOrBefore) {
  const key = `${ticker}|${onOrBefore}`;
  if (priceCache.has(key)) return priceCache.get(key);
  const end = new Date(`${onOrBefore}T00:00:00Z`);
  const start = new Date(end.getTime() - 14 * 86400000);
  let value = null;
  try {
    const r = await yf.chart(ticker, {
      period1: start.toISOString().slice(0, 10),
      period2: new Date(end.getTime() + 86400000).toISOString().slice(0, 10),
      interval: '1d',
    });
    const usable = (r.quotes ?? []).filter(
      (q) => q.close != null && q.date && new Date(q.date) <= new Date(`${onOrBefore}T23:59:59Z`),
    );
    value = usable.length ? usable[usable.length - 1].close : null;
  } catch (err) {
    console.error(`    ${ticker}: price lookup failed — ${err.message}`);
  }
  priceCache.set(key, value);
  return value;
}

function intrinsic(side, underlying, strike) {
  return side === 'call' ? Math.max(0, underlying - strike) : Math.max(0, strike - underlying);
}

const rows = await sql.query(`
  select b.id basket_id, b.slug, b.week_of::text week_of,
         p.id position_id, p.ticker, p.side, p.strike::float strike,
         p.expiry::text expiry, p.entry_underlying_price::float entry_px,
         p.estimated_entry_credit::float credit, p.contracts, p.margin,
         p.entry_timestamp,
         (select count(*)::int from performance_snapshots where position_id = p.id) snaps
  from baskets b
  join positions p on p.basket_id = b.id
  where b.status = 'archived'
    and p.expiry < current_date
  order by b.week_of desc, p.sort_order
`);

const targets = args.all ? rows : rows.filter((r) => r.snaps === 0);
if (!targets.length) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

const byBasket = new Map();
for (const r of targets) {
  if (!byBasket.has(r.slug)) byBasket.set(r.slug, []);
  byBasket.get(r.slug).push(r);
}
console.log(`${targets.length} position(s) across ${byBasket.size} settled basket(s).`);
if (args.dryRun) {
  for (const [slug, rs] of byBasket) console.log(`  ${slug}: ${rs.length}`);
  process.exit(0);
}

let wrote = 0;
let failed = 0;

for (const [slug, positionsForBasket] of byBasket) {
  let basketPnl = 0;
  for (const r of positionsForBasket) {
    const settle = await closeOnOrBefore(r.ticker, r.expiry);
    if (settle == null) {
      console.error(`  ${slug} ${r.ticker}: no settlement price, skipped`);
      failed++;
      continue;
    }

    const iv = intrinsic(r.side, settle, r.strike);
    const state = iv > 0 ? 'expired-itm' : 'expired-otm';
    const pnl = (r.credit - iv) * 100 * r.contracts;
    const pnlPct = r.margin ? (pnl / r.margin) * 100 : 0;
    const capture = r.credit ? Math.max(-5, Math.min(1, (r.credit - iv) / r.credit)) : 0;
    const movePct = r.entry_px ? ((settle - r.entry_px) / r.entry_px) * 100 : 0;
    const distance = settle ? ((r.strike - settle) / settle) * 100 : 0;
    basketPnl += pnl;

    // Entry point (t=0) so the position chart has a baseline.
    await sql.query(
      `insert into performance_snapshots
         (basket_id, position_id, observed_at, underlying_price, option_mark,
          estimated_option_value, confidence, state, underlying_move_pct,
          distance_to_strike, safety_buffer_pct, days_to_expiry, credit_capture_pct,
          pnl_amount, pnl_percent, source_label)
       values ($1,$2,$3,$4,$5,$6,'Actual','safe',0,$7,$8,$9,0,0,0,'Entry (backfilled)')
       on conflict (position_id, observed_at) do nothing`,
      [
        r.basket_id,
        r.position_id,
        r.entry_timestamp,
        r.entry_px,
        r.credit,
        r.credit,
        r.entry_px ? ((r.strike - r.entry_px) / r.entry_px) * 100 : 0,
        r.entry_px ? (Math.abs(r.strike - r.entry_px) / r.entry_px) * 100 : 0,
        Math.max(
          0,
          Math.round(
            (new Date(`${r.expiry}T00:00:00Z`) - new Date(r.entry_timestamp)) / 86400000,
          ),
        ),
      ],
    );

    // Settlement point.
    await sql.query(
      `insert into performance_snapshots
         (basket_id, position_id, observed_at, underlying_price, option_mark,
          estimated_option_value, confidence, state, underlying_move_pct,
          distance_to_strike, safety_buffer_pct, days_to_expiry, credit_capture_pct,
          pnl_amount, pnl_percent, source_label)
       values ($1,$2,$3,$4,$5,$6,'Expiry-Resolved',$7,$8,$9,$10,0,$11,$12,$13,'Expiry settlement (Yahoo close)')
       on conflict (position_id, observed_at) do nothing`,
      [
        r.basket_id,
        r.position_id,
        `${r.expiry}T20:00:00Z`,
        settle,
        iv,
        iv,
        state,
        movePct,
        distance,
        Math.abs(distance),
        capture,
        pnl,
        pnlPct,
      ],
    );
    wrote++;
  }
  console.log(
    `  ${slug}: ${positionsForBasket.length} settled, basket P&L $${Math.round(basketPnl).toLocaleString()}`,
  );
  await sql.query(`update baskets set last_refresh_at = now() where slug = $1`, [slug]);
}

console.log(`\nBackfilled ${wrote} position(s)${failed ? `, ${failed} failed` : ''}.`);
if (failed) process.exitCode = 1;
