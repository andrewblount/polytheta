#!/usr/bin/env node
// Monday-morning revalidation of the weekly basket against live prices.
//
// The orchestrator screens Sunday night on Friday closes. FCEL (May 11) had
// closed +11.6% Friday and opened Monday far above the proposal price — the
// entry math (strike distance, buffer, credit) was stale before the first
// order went in. This script re-quotes every pick shortly after Monday open
// and flags any name whose price has moved enough to invalidate the entry.
//
//   node scripts/verify_basket_live.mjs              # current week's basket
//   node scripts/verify_basket_live.mjs --date 2026-07-27
//
// Writes baskets/<date>/REVALIDATION.md and emails a summary when any pick
// is flagged. Run from launchd Monday ~09:35 ET.

import fs from 'node:fs';
import path from 'node:path';
import YahooFinanceMod from 'yahoo-finance2';
import { deriveBasketDate } from './lib/basket_date.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(REPO_ROOT, '.env.local')); } catch { /* optional */ }

const YF = YahooFinanceMod.default ?? YahooFinanceMod;
const yf = new YF({ validation: { logErrors: false }, suppressNotices: ['yahooSurvey'] });

// Flag thresholds: price moved >4% or >0.5 ATR against the entry assumption,
// or the remaining buffer to strike dropped below the side's floor.
const MAX_DRIFT_PCT = 4;
const MAX_DRIFT_ATR = 0.5;

const dateArg = process.argv.includes('--date')
  ? process.argv[process.argv.indexOf('--date') + 1]
  : deriveBasketDate();

const proposalFile = path.join(REPO_ROOT, 'baskets', dateArg, 'data', 'basket_proposal.json');
if (!fs.existsSync(proposalFile)) {
  console.error(`No proposal at ${proposalFile}`);
  process.exit(1);
}
const proposal = JSON.parse(fs.readFileSync(proposalFile, 'utf8'));

const rows = [];
let flagged = 0;
for (const p of proposal.picks) {
  let live = null;
  try {
    const q = await yf.quote(p.ticker);
    live = q?.regularMarketPrice ?? null;
  } catch { /* leave null */ }
  if (live == null) {
    rows.push({ ...p, live: null, verdict: 'NO QUOTE — verify manually' });
    flagged++;
    continue;
  }
  const driftPct = ((live - p.px) / p.px) * 100;
  const driftAtr = p.atr ? (live - p.px) / p.atr : 0;
  // Adverse drift: toward the strike (up for calls, down for puts).
  const adverse = p.side === 'call' ? driftPct : -driftPct;
  const liveBuf = p.atr ? (p.side === 'call' ? (p.K - live) / p.atr : (live - p.K) / p.atr) : null;
  const bufFloor = p.side === 'put' ? 2.0 : 1.0;
  let verdict = 'OK';
  if (adverse >= MAX_DRIFT_PCT || (p.atr && (p.side === 'call' ? driftAtr : -driftAtr) >= MAX_DRIFT_ATR)) {
    verdict = `STALE — moved ${driftPct.toFixed(1)}% against entry, re-strike or skip`;
  }
  if (liveBuf != null && liveBuf < bufFloor) {
    verdict = `BUFFER GONE — ${liveBuf.toFixed(2)}x ATR remaining (floor ${bufFloor}x), skip or re-strike`;
  }
  if (verdict !== 'OK') flagged++;
  rows.push({ ...p, live, driftPct: +driftPct.toFixed(1), liveBuf: liveBuf != null ? +liveBuf.toFixed(2) : null, verdict });
}

const md = [
  `# Monday Revalidation — ${dateArg}`,
  '',
  `Checked ${new Date().toISOString()} against the Sunday proposal. ${flagged ? `**${flagged} pick(s) flagged.**` : 'All picks within tolerance.'}`,
  '',
  '| ticker | side | K | proposal px | live | drift | live ATR buf | verdict |',
  '|--------|------|---|------------:|-----:|------:|-------------:|---------|',
  ...rows.map((r) =>
    `| ${r.ticker} | ${r.side} | ${r.K} | ${r.px} | ${r.live ?? '—'} | ${r.driftPct != null ? r.driftPct + '%' : '—'} | ${r.liveBuf ?? '—'} | ${r.verdict} |`),
  '',
  flagged
    ? 'Flagged names violate the entry assumptions the basket was built on. Re-strike from the live chain (respecting delta 0.15–0.20, spread ≤ $0.15, put buffer ≥ 2x ATR) or drop the name.'
    : 'Enter per the proposal, verifying credits against the live chain.',
].join('\n');

const outFile = path.join(REPO_ROOT, 'baskets', dateArg, 'REVALIDATION.md');
fs.writeFileSync(outFile, md);
console.log(md);
console.log(`\nwrote ${outFile}`);

// Email when anything is flagged.
if (flagged && process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
  const to = process.env.STOP_ALERT_EMAIL || process.env.ACCESS_REQUEST_NOTIFY_EMAIL || 'ablount@bluecielo.com';
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject: `Basket revalidation: ${flagged} pick(s) STALE — ${dateArg}` }],
      from: { email: process.env.SENDGRID_FROM_EMAIL },
      content: [{ type: 'text/plain', value: md }],
    }),
  });
  console.log(res.ok ? `emailed ${to}` : `email failed: ${res.status} ${await res.text()}`);
}
