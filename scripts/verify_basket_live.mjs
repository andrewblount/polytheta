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

// ---- Notifications: HTML email + iMessage when anything is flagged ----
// (Visual template kept in sync with src/server/services/email.ts.)
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function verdictBadge(v) {
  const [bg, fg, label] = v === 'OK'
    ? ['#ecfdf3', '#027a48', 'OK']
    : v.startsWith('BUFFER')
      ? ['#fef3f2', '#b42318', 'BUFFER GONE']
      : v.startsWith('STALE')
        ? ['#fffaeb', '#b54708', 'STALE']
        : ['#f2f4f7', '#475467', 'NO QUOTE'];
  return `<span style="background:${bg};color:${fg};font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap">${label}</span>`;
}
const rowsHtml = rows.map((r, i) => {
  const drift = r.driftPct != null ? `${r.driftPct > 0 ? '+' : ''}${r.driftPct}%` : '—';
  const driftColor = r.driftPct != null && ((r.side === 'call' && r.driftPct > 0) || (r.side === 'put' && r.driftPct < 0)) ? '#b42318' : '#027a48';
  return `<tr style="background:${i % 2 ? '#f9fafb' : '#ffffff'}">
    <td style="padding:9px 10px;font-weight:700">${esc(r.ticker)} <span style="color:#667085;font-weight:400">${r.side === 'call' ? 'C' : 'P'} $${r.K}</span></td>
    <td style="padding:9px 10px;text-align:right;color:#667085">$${r.px}</td>
    <td style="padding:9px 10px;text-align:right;font-weight:600">${r.live != null ? '$' + r.live : '—'}</td>
    <td style="padding:9px 10px;text-align:right;color:${driftColor};font-weight:600">${drift}</td>
    <td style="padding:9px 10px;text-align:right">${r.liveBuf != null ? r.liveBuf + 'x' : '—'}</td>
    <td style="padding:9px 10px;text-align:right">${verdictBadge(r.verdict)}</td>
  </tr>`;
}).join('');
const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101828">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden">
  <div style="background:${flagged ? '#b54708' : '#027a48'};color:#fff;padding:14px 20px;font-size:15px;font-weight:700;letter-spacing:.3px">
    MONDAY REVALIDATION — ${flagged ? `${flagged} PICK${flagged > 1 ? 'S' : ''} NEED ACTION` : 'ALL CLEAR'}
  </div>
  <div style="padding:20px">
    <h1 style="margin:0 0 4px;font-size:18px">Basket ${dateArg}</h1>
    <p style="margin:0 0 14px;font-size:13px;color:#667085">Live quotes vs the pre-dawn proposal · checked ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="color:#667085;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px">
        <th style="padding:6px 10px;text-align:left">Name</th><th style="padding:6px 10px">Proposal</th><th style="padding:6px 10px">Live</th><th style="padding:6px 10px">Drift</th><th style="padding:6px 10px">ATR buf</th><th style="padding:6px 10px">Verdict</th>
      </tr>${rowsHtml}
    </table>
    <p style="margin:16px 0 0;font-size:14px;line-height:1.5;background:${flagged ? '#fffaeb;border:1px solid #fedf89' : '#ecfdf3;border:1px solid #a6f4c5'};border-radius:8px;padding:10px 12px">
      ${flagged
        ? '<strong>Flagged names violate the entry math the basket was built on.</strong> Re-strike from the live chain (delta 0.15–0.20, spread ≤ $0.15, put buffer ≥ 2x ATR) or drop the name.'
        : 'Enter per the proposal, verifying credits against the live chain.'}
    </p>
  </div>
</div>
<p style="max-width:640px;margin:12px auto 0;font-size:11px;color:#98a2b3;text-align:center">Polytheta · prices are snapshots — always confirm at the broker.</p>
</body></html>`;

if (flagged && process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
  const to = process.env.STOP_ALERT_EMAIL || process.env.ACCESS_REQUEST_NOTIFY_EMAIL || 'ablount@bluecielo.com';
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject: `Basket revalidation: ${flagged} pick(s) need action — ${dateArg}` }],
      from: { email: process.env.SENDGRID_FROM_EMAIL },
      content: [
        { type: 'text/plain', value: md },
        { type: 'text/html', value: html },
      ],
    }),
  });
  console.log(res.ok ? `emailed ${to}` : `email failed: ${res.status} ${await res.text()}`);
}

// iMessage (this script runs on the Mac): short, actionable summary.
if (flagged && process.env.ALERT_IMESSAGE_TO) {
  const flaggedNames = rows.filter((r) => r.verdict !== 'OK').map((r) => r.ticker).join(', ');
  const text = `⚠️ Polytheta revalidation: ${flagged} pick${flagged > 1 ? 's' : ''} need action — ${flaggedNames}. Re-strike or drop before entry. Details in email.`;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('osascript', ['-e',
      `tell application "Messages" to send ${JSON.stringify(text)} to participant ${JSON.stringify(process.env.ALERT_IMESSAGE_TO)} of (1st account whose service type = iMessage)`,
    ]);
    console.log(`iMessaged ${process.env.ALERT_IMESSAGE_TO}`);
  } catch (err) {
    console.error('iMessage failed:', err.message);
  }
}
