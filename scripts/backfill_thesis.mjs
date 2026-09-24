#!/usr/bin/env node
// Write a trading thesis for every basket already in the database that has
// none (baskets published before thesis generation existed). The thesis is
// generated from the stored selection data: each position's source_metadata
// is the pick the model built, market_conditions holds the macro inputs.
//
//   node scripts/backfill_thesis.mjs [--dry-run] [--all]
import path from 'node:path';
import postgres from 'postgres';
import { basketThesis, pickSummary } from '../shared/basket-thesis.mjs';

const root = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply values */ }
const url = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('Set NETLIFY_DATABASE_URL'); process.exit(1); }
const dryRun = process.argv.includes('--dry-run'), all = process.argv.includes('--all');
const sql = postgres(url, { max: 1 });
try {
  const baskets = await sql`select b.id, b.slug, b.week_of::text as week_of, b.gsrs, m.other_metrics, mc.vix, mc.skew, mc.hy_oas, mc.move, mc.put_call_ratio, mc.gsrs_note
    from baskets b join basket_metrics m on m.basket_id=b.id join market_conditions mc on mc.basket_id=b.id order by b.week_of`;
  let written = 0;
  for (const b of baskets) {
    const other = b.other_metrics ?? {};
    if (other.thesis && !all) continue;
    const rows = await sql`select id, ticker, side, strike, expiry::text as expiry, contracts, margin, estimated_entry_credit, entry_underlying_price, delta, atr_14d, source_metadata, thesis_summary from positions where basket_id=${b.id} order by sort_order`;
    if (!rows.length) continue;
    const picks = rows.map(r => ({ ticker: r.ticker, side: r.side, K: Number(r.strike), contracts: r.contracts, margin: r.margin, cr: Number(r.estimated_entry_credit), px: Number(r.entry_underlying_price), delta: Number(r.delta), atr: r.atr_14d != null ? Number(r.atr_14d) : null, credit: Math.round(Number(r.estimated_entry_credit) * 100 * r.contracts), ...(r.source_metadata ?? {}) }));
    const components = Object.fromEntries([...String(b.gsrs_note ?? '').matchAll(/\b(vix|skew|hyoas|move|pc) ([0-9.]+)/g)].map(m => [m[1], Number(m[2])]));
    const proposal = { basket_date: b.week_of, expiry: rows[0].expiry, gsrs: Number(b.gsrs), gsrs_components: components,
      macro: { VIX: Number(b.vix), SKEW: Number(b.skew), HY_OAS: Number(b.hy_oas), MOVE: Number(b.move), PC: Number(b.put_call_ratio) },
      picks, pool_counts: other.pool_counts ?? null, allocation_settings: other.allocation_settings ?? undefined, allocation_scale: other.allocation_scale ?? 1,
      model_equity: other.model_equity ?? null, model_equity_source: other.model_equity_source ?? null, entry_timestamp: other.entry_timestamp ?? null,
      late: Boolean(other.late), late_note: other.late_note ?? null, data_provenance: other.data_provenance ?? 'live-snapshot', reconstruction: other.reconstruction ?? null };
    const thesis = basketThesis(proposal);
    console.log(`${b.slug}: ${thesis.headline}`);
    if (dryRun) continue;
    await sql`update basket_metrics set other_metrics = ${sql.json({ ...other, thesis, data_provenance: other.data_provenance ?? 'live-snapshot', thesis_backfilled_at: new Date().toISOString() })}, updated_at = now() where basket_id=${b.id}`;
    for (const r of rows) {
      const pick = picks.find(p => p.ticker === r.ticker && p.side === r.side && p.K === Number(r.strike));
      const text = thesis.picks.find(t => t.ticker === r.ticker && t.side === r.side && t.strike === Number(r.strike))?.text ?? null;
      const summary = r.thesis_summary?.startsWith('Auto:') || r.thesis_summary === 'Auto-selected.' ? pickSummary(pick) : r.thesis_summary;
      await sql`update positions set thesis_summary=${summary}, source_metadata=${sql.json({ ...(r.source_metadata ?? {}), thesis_text: text })}, updated_at=now() where id=${r.id}`;
    }
    written++;
  }
  console.log(`${dryRun ? 'Would write' : 'Wrote'} theses for ${written} basket(s)`);
} finally { await sql.end(); }
