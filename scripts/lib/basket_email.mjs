// Weekly basket email — the trading instructions, formatted to be read on a
// phone at the open. Same design language as the alert emails
// (src/server/services/email.ts alertEmailShell — keep visually in sync).
// Old proposals lack some fields (si_pct, frenzy, constraints); render "—".

import { orderBlocks } from './import_proposal.mjs';

const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const money = (n) => `$${Math.round(n).toLocaleString()}`;

function chip(text, bg, fg) {
  return `<span style="background:${bg};color:${fg};font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap">${esc(text)}</span>`;
}

function gsrsChip(gsrs) {
  if (gsrs < 3) return chip(`GSRS ${gsrs}`, '#ecfdf3', '#027a48');
  if (gsrs < 5) return chip(`GSRS ${gsrs}`, '#fffaeb', '#b54708');
  return chip(`GSRS ${gsrs}`, '#fef3f2', '#b42318');
}

export function buildBasketEmailHtml(proposal) {
  const p = proposal;
  const cons = p.constraints ?? {};
  const calls = p.picks.filter((x) => x.side === 'call');
  const puts = p.picks.filter((x) => x.side === 'put');
  const totalMargin = (p.totals?.callMargin ?? 0) + (p.totals?.putMargin ?? 0);
  const totalCredit = (p.totals?.callCredit ?? 0) + (p.totals?.putCredit ?? 0);
  const rom = totalMargin ? ((totalCredit / totalMargin) * 100).toFixed(2) : '—';

  const pickRow = (x, i) => {
    const flags = [];
    if (x.frenzy === 'elevated') flags.push('FRENZY — half size');
    if (x.earnings_date && !x.earnings_clear) flags.push(`EARNINGS ${x.earnings_date}`);
    const cov = x.rule_checks?.thesis_coverage;
    return `<tr style="background:${i % 2 ? '#f9fafb' : '#ffffff'}">
      <td style="padding:9px 10px"><span style="font-weight:700">${esc(x.ticker)}</span><br><span style="font-size:11px;color:#667085">$${x.px} · ${esc(x.family ?? '')}</span></td>
      <td style="padding:9px 10px;text-align:right;font-weight:600">$${x.K}</td>
      <td style="padding:9px 10px;text-align:right">${x.cr?.toFixed ? x.cr.toFixed(2) : x.cr}</td>
      <td style="padding:9px 10px;text-align:right">${x.contracts?.toLocaleString?.() ?? x.contracts}</td>
      <td style="padding:9px 10px;text-align:right">${money(x.margin)}</td>
      <td style="padding:9px 10px;text-align:right">${money(x.credit)}</td>
      <td style="padding:9px 10px;text-align:right;font-size:12px;color:#667085">${x.si_pct != null ? x.si_pct + '%' : '—'} · ${x.buf}x${cov ? ' · ' + cov : ''}${flags.length ? `<br><span style="color:#b54708;font-weight:600">${esc(flags.join(' · '))}</span>` : ''}</td>
    </tr>`;
  };

  const sideTable = (label, rows, color) => rows.length ? `
    <h2 style="margin:18px 0 8px;font-size:14px;color:${color};text-transform:uppercase;letter-spacing:.5px">${label} — ${rows.length}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="color:#667085;font-size:11px;text-transform:uppercase;letter-spacing:.4px;text-align:right">
        <th style="padding:6px 10px;text-align:left">Name</th><th style="padding:6px 10px">Strike</th><th style="padding:6px 10px">Credit</th><th style="padding:6px 10px">Qty</th><th style="padding:6px 10px">Margin</th><th style="padding:6px 10px">Credit $</th><th style="padding:6px 10px">SI · Buf · Cov</th>
      </tr>${rows.map(pickRow).join('')}
    </table>` : `<h2 style="margin:18px 0 8px;font-size:14px;color:${color}">${label}</h2><p style="margin:0;font-size:13px;color:#667085">No entries this week${cons.puts_allowed === false ? ` — GSRS band ${cons.gsrs_band} prohibits new puts` : ''}.</p>`;

  const blocks = orderBlocks(p.picks, p.expiry);
  const blocksHtml = blocks.map((b) => `
    <h3 style="margin:14px 0 6px;font-size:13px;color:#101828">${esc(b.broker)} — ${esc(b.title)}</h3>
    <pre style="margin:0;background:#0b1524;color:#c6d4ef;font-size:11.5px;line-height:1.6;padding:12px;border-radius:8px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(b.orderText)}</pre>`).join('');

  const m = p.macro ?? {};
  const marketHtml = `<table style="width:100%;border-collapse:collapse;font-size:12px;color:#475467;margin:4px 0 0">
    <tr>${[['VIX', m.VIX], ['SKEW', m.SKEW], ['HY OAS', m.HY_OAS != null ? m.HY_OAS + '%' : null], ['MOVE', m.MOVE], ['P/C', m.PC]]
      .map(([k, v]) => `<td style="padding:6px 8px;text-align:center;border:1px solid #e4e7ec"><div style="font-size:10px;text-transform:uppercase;color:#98a2b3">${k}</div><div style="font-weight:700;font-size:13px;color:#101828">${v ?? '—'}</div></td>`).join('')}</tr>
  </table>`;

  return `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101828">
<div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden">
  <div style="background:#0b1524;color:#ffffff;padding:16px 20px">
    <div style="font-size:15px;font-weight:700;letter-spacing:.3px"><span style="color:#88b4ff">Θ</span> POLYTHETA — WEEKLY BASKET</div>
    <div style="font-size:12px;color:#98a2b3;margin-top:2px">Entry ${esc(p.basket_date)} · Expiry ${esc(p.expiry)} · Hold to expiry (policy v3)</div>
  </div>
  <div style="padding:20px">
    <div style="margin:0 0 10px">${gsrsChip(p.gsrs)} ${cons.put_budget != null ? chip(`put budget ${money(cons.put_budget)}/name`, '#f2f4f7', '#475467') : ''} ${cons.gsrs_band ? chip(`band ${cons.gsrs_band}`, '#f2f4f7', '#475467') : ''}</div>
    ${marketHtml}
    ${sideTable('Calls (short)', calls, '#b42318')}
    ${sideTable('Puts (short)', puts, '#175cd3')}
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0 0;background:#f9fafb;border:1px solid #e4e7ec;border-radius:8px">
      <tr>
        <td style="padding:10px 12px"><div style="font-size:10px;text-transform:uppercase;color:#98a2b3">Total margin</div><div style="font-weight:700">${money(totalMargin)}</div></td>
        <td style="padding:10px 12px"><div style="font-size:10px;text-transform:uppercase;color:#98a2b3">Cash at 4x</div><div style="font-weight:700">${money(totalMargin / 4)}</div></td>
        <td style="padding:10px 12px"><div style="font-size:10px;text-transform:uppercase;color:#98a2b3">Est. credit</div><div style="font-weight:700;color:#027a48">${money(totalCredit)}</div></td>
        <td style="padding:10px 12px"><div style="font-size:10px;text-transform:uppercase;color:#98a2b3">RoM max</div><div style="font-weight:700">${rom}%</div></td>
      </tr>
    </table>
    <h2 style="margin:20px 0 4px;font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#101828">Copy-paste orders</h2>
    <p style="margin:0 0 4px;font-size:12px;color:#667085">Verify every strike, credit, and margin figure against the live chain before submitting. The 07:35/08:35 revalidation email flags anything stale.</p>
    ${blocksHtml}
    <p style="margin:16px 0 0;font-size:13px;font-weight:700;color:#027a48">Basket loaded — ready to execute.</p>
  </div>
  <div style="padding:12px 20px;border-top:1px solid #e4e7ec;font-size:12px;color:#667085">
    <a href="https://polytheta.com/app/baskets/current" style="color:#2f6fed">Open in Polytheta →</a>
  </div>
</div>
<p style="max-width:680px;margin:12px auto 0;font-size:11px;color:#98a2b3;text-align:center">Modeled recommendations, not financial advice. Naked options carry risk of loss exceeding the account. Verify everything at the broker.</p>
</body></html>`;
}

export async function sendBasketEmail(proposal, { subjectPrefix = '' } = {}) {
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const to = process.env.STOP_ALERT_EMAIL || process.env.ACCESS_REQUEST_NOTIFY_EMAIL || 'ablount@bluecielo.com';
  if (!key || !from) return { sent: false, reason: 'sendgrid-not-configured' };

  const totalCredit = (proposal.totals?.callCredit ?? 0) + (proposal.totals?.putCredit ?? 0);
  const subject = `${subjectPrefix}Weekly Basket ${proposal.basket_date} — ${proposal.picks.length} names, ~$${Math.round(totalCredit).toLocaleString()} credit, GSRS ${proposal.gsrs}`;
  const text = proposal.picks
    .map((x) => `${x.side.toUpperCase()} ${x.ticker} $${x.K} ${proposal.expiry} — ${x.contracts}x @ ${x.cr} (margin $${x.margin.toLocaleString()})`)
    .join('\n');

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject }],
      from: { email: from },
      content: [
        { type: 'text/plain', value: `${subject}\n\n${text}\n\nVerify against live chains before trading.` },
        { type: 'text/html', value: buildBasketEmailHtml(proposal) },
      ],
    }),
  });
  return { sent: res.ok, status: res.status, to };
}
