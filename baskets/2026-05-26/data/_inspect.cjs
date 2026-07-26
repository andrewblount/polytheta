const fs = require('node:fs');
const path = require('node:path');
const DIR = __dirname;
function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const H = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const c = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else { if (ch === '"') q = true; else if (ch === ',') { c.push(cur); cur = ''; } else cur += ch; }
    }
    c.push(cur);
    const o = {}; H.forEach((h, i) => (o[h] = c[i])); return o;
  });
}
for (const [f, side] of [['shortlist_calls_no_earnings.csv', 'CALL'], ['shortlist_puts_no_earnings.csv', 'PUT']]) {
  const rows = readCsv(path.join(DIR, f));
  const out = rows.map((r) => {
    const iv = parseFloat(side === 'CALL' ? r.best_call_iv : r.best_put_iv) || 0;
    const cr = parseFloat(side === 'CALL' ? r.best_call_credit : r.best_put_credit) || 0;
    const K = parseFloat(side === 'CALL' ? r.best_call_strike : r.best_put_strike) || 0;
    const buf = parseFloat(side === 'CALL' ? r.call_atr_buf : r.put_atr_buf) || 0;
    return { t: r.ticker, name: (r.name || '').slice(0, 26), px: parseFloat(r.price), iv: iv * 100, cr, K, buf, ed: r.earnings_date, sc: iv * 100 * Math.min(buf, 4) * cr };
  });
  console.log('=== ' + side + ' (' + rows.length + ' rows), buf>=1.25 by composite ===');
  out.filter((r) => r.buf >= 1.25).sort((a, b) => b.sc - a.sc).slice(0, 22).forEach((r) => {
    console.log('  ' + r.t.padEnd(6) + ' ' + r.name.padEnd(27) + ' px=' + r.px.toFixed(2).padStart(7) + ' iv=' + r.iv.toFixed(0).padStart(4) + '% K=' + String(r.K).padStart(6) + ' cr=' + r.cr.toFixed(2) + ' buf=' + r.buf.toFixed(2) + ' ed=' + (r.ed || '-').padEnd(11) + ' sc=' + r.sc.toFixed(0));
  });
}
