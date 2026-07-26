#!/usr/bin/env node
// Exit-policy simulation over every settled leg in the site DB.
//
//   node scripts/research/sim_exit_policies.mjs
//
// Policies compared on identical entries (walk-forward, entry credit as
// recorded, daily Yahoo OHLC for the hold week, Black-Scholes at entry IV
// for mid-week option values — an approximation; treat small differences
// as noise):
//   A  hold to expiry (the published record)
//   B  the spec's double protocol: double at 0.5x ATR break, double again
//      at 1x ATR, then dump everything
//   C  no doubles, hard exit when price crosses the 1x ATR break
//   D  no doubles, exit when option P&L reaches -STOP_FRACTION of margin
//      ("close" = checked at daily close; "trigger" = filled at the stop
//      level, which approximates real-time monitoring)
//
// July 2026 result (96 legs): A +$280K | B +$125K | C +$156K |
// D(25%, trigger) +$400K, worst leg -$14K. Doubling and price-level exits
// both lose to a simple P&L stop because these names cross 1x ATR in half
// of all weeks while only ~10% of legs finish ITM. See
// docs/risk_policy_v2.md. Rerun as more weeks settle.

import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import YahooFinanceMod from 'yahoo-finance2';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
try { process.loadEnvFile(path.join(REPO_ROOT, '.env.local')); } catch { /* optional */ }

const STOP_FRACTIONS = [0.25, 0.35, 0.5];
const R = 0.045;

const url = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set NETLIFY_DATABASE_URL (or put it in .env.local).'); process.exit(1); }
const sql = neon(url);
const YF = YahooFinanceMod.default ?? YahooFinanceMod;
const yf = new YF({ validation: { logErrors: false }, suppressNotices: ['yahooSurvey'] });

function ncdf(x){const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;const s=x<0?-1:1;x=Math.abs(x)/Math.SQRT2;const t=1/(1+p*x);const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);return 0.5*(1+s*y);}
function bs(S,K,T,r,sig,side){if(T<=0)return side==='call'?Math.max(S-K,0):Math.max(K-S,0);const d1=(Math.log(S/K)+(r+0.5*sig*sig)*T)/(sig*Math.sqrt(T)),d2=d1-sig*Math.sqrt(T);return side==='call'?S*ncdf(d1)-K*Math.exp(-r*T)*ncdf(d2):K*Math.exp(-r*T)*ncdf(-d2)-S*ncdf(-d1);}
const intrinsic=(S,K,side)=>side==='call'?Math.max(S-K,0):Math.max(K-S,0);

const legs = (await sql.query(`
  with last as (
    select distinct on (s.position_id) s.position_id, s.pnl_amount, s.state
    from performance_snapshots s where s.state in ('expired-otm','expired-itm')
    order by s.position_id, s.observed_at desc)
  select p.ticker, p.side, p.strike::float k, p.entry_underlying_price::float px,
         p.estimated_entry_credit::float cr, p.contracts, p.margin,
         p.expiry::text expiry, b.week_of::text wk, p.atr_14d::float atr,
         (p.source_metadata->>'iv')::float iv,
         round(l.pnl_amount)::int base_pnl, l.state
  from last l join positions p on p.id = l.position_id join baskets b on b.id = p.basket_id
  order by b.week_of`)).filter((l) => l.atr && l.iv);
console.log(`settled legs with full data: ${legs.length}`);

const bars = {};
for (const l of legs) {
  const key = `${l.ticker}|${l.wk}`;
  if (bars[key]) continue;
  try {
    const end = new Date(new Date(l.expiry + 'T00:00:00Z').getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const r = await yf.chart(l.ticker, { period1: l.wk, period2: end, interval: '1d' });
    bars[key] = r.quotes.filter((q) => q.high != null && q.low != null && q.close != null)
      .map((q) => ({ d: q.date.toISOString().slice(0, 10), h: q.high, l: q.low, c: q.close }));
  } catch { bars[key] = []; }
  await new Promise((res) => setTimeout(res, 100));
}

function simulate(l) {
  const week = (bars[`${l.ticker}|${l.wk}`] ?? []).filter((b) => b.d >= l.wk && b.d <= l.expiry);
  const out = { A: l.base_pnl, B: l.base_pnl, C: l.base_pnl, D: {} };
  for (const f of STOP_FRACTIONS) out.D[f] = { close: l.base_pnl, trigger: l.base_pnl };
  if (!week.length) return out;
  const dir = l.side === 'call' ? 1 : -1;
  const B1 = l.px + dir * 0.5 * l.atr, B2 = l.px + dir * 1.0 * l.atr;
  const expiryT = new Date(l.expiry + 'T00:00:00Z').getTime();
  const Tof = (d) => Math.max((expiryT - new Date(d + 'T00:00:00Z').getTime()) / (365 * 86400000), 0.5 / 365);
  const touched = (b, lvl) => (l.side === 'call' ? b.h >= lvl : b.l <= lvl);
  const I = l.cr - l.base_pnl / (100 * l.contracts);
  let t1 = null, t2 = null;
  for (const b of week) { if (!t1 && touched(b, B1)) t1 = b; if (!t2 && touched(b, B2)) t2 = b; }
  const val = (S, d) => Math.max(bs(S, l.k, Tof(d), R, l.iv, l.side), intrinsic(S, l.k, l.side));
  const v1 = t1 ? val(B1, t1.d) : null;
  const v2 = t2 ? val(B2, t2.d) : null;
  if (t2) out.B = Math.round((l.cr + (v1 ?? v2) - 2 * v2) * 100 * l.contracts);
  else if (t1) out.B = Math.round((l.cr + v1 - 2 * I) * 100 * l.contracts);
  if (t2) out.C = Math.round((l.cr - v2) * 100 * l.contracts);
  for (const f of STOP_FRACTIONS) {
    for (const b of week) {
      const v = val(b.c, b.d);
      const pnlNow = (l.cr - v) * 100 * l.contracts;
      if (pnlNow <= -f * l.margin) {
        out.D[f] = { close: Math.round(pnlNow), trigger: Math.round(-f * l.margin) };
        break;
      }
    }
  }
  return out;
}

const sims = legs.map((l) => ({ l, r: simulate(l) }));
const tot = (get) => sims.reduce((s, x) => s + get(x.r), 0);
const worst = (get) => sims.reduce((m, x) => Math.min(m, get(x.r)), 0);
console.log(`\nA  hold to expiry:       $${tot((r) => r.A).toLocaleString()}  worst $${worst((r) => r.A).toLocaleString()}`);
console.log(`B  double protocol:      $${tot((r) => r.B).toLocaleString()}  worst $${worst((r) => r.B).toLocaleString()}`);
console.log(`C  exit at 1x ATR break: $${tot((r) => r.C).toLocaleString()}  worst $${worst((r) => r.C).toLocaleString()}`);
for (const f of STOP_FRACTIONS) {
  for (const mode of ['close', 'trigger']) {
    console.log(`D  ${(f * 100).toFixed(0)}% P&L stop (${mode}):  $${tot((r) => r.D[f][mode]).toLocaleString()}  worst $${worst((r) => r.D[f][mode]).toLocaleString()}`);
  }
}
