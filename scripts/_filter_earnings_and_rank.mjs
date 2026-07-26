// Filters refined shortlists by earnings during the holding period and re-ranks.
// Reads:
//   baskets/<basket_date>/data/shortlist_calls_refined.csv
//   baskets/<basket_date>/data/shortlist_puts_refined.csv
//   baskets/<basket_date>/data/earnings_dates.json
// Writes:
//   baskets/<basket_date>/data/shortlist_calls_no_earnings.csv
//   baskets/<basket_date>/data/shortlist_puts_no_earnings.csv
// Prints top 25 of each.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASKET_DATE = process.argv[2] ?? '2026-04-27';
const HOLD_START = process.argv[3] ?? '2026-04-27';
const HOLD_END = process.argv[4] ?? '2026-05-01';
const OUT = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return {
    header,
    rows: lines.slice(1).map((l) => {
      const cells = [];
      let cur = '', inQ = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (inQ) {
          if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') inQ = false;
          else cur += c;
        } else {
          if (c === '"') inQ = true;
          else if (c === ',') { cells.push(cur); cur = ''; }
          else cur += c;
        }
      }
      cells.push(cur);
      const obj = {};
      header.forEach((h, i) => { obj[h] = cells[i]; });
      return obj;
    }),
  };
}

function writeCsv(p, rows, cols) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  fs.writeFileSync(p, lines.join('\n'));
}

const earningsByT = JSON.parse(
  fs.readFileSync(path.join(OUT, 'earnings_dates.json'), 'utf8')
);

function earningsInWindow(ticker) {
  const e = earningsByT[ticker];
  if (!e || !e.next_date) return null;
  if (e.next_date >= HOLD_START && e.next_date <= HOLD_END) return e.next_date;
  return null;
}

function pickFields(r, side) {
  const iv = parseFloat(side === 'CALL' ? r.best_call_iv : r.best_put_iv) || 0;
  const cr = parseFloat(side === 'CALL' ? r.best_call_credit : r.best_put_credit) || 0;
  const K = parseFloat(side === 'CALL' ? r.best_call_strike : r.best_put_strike) || 0;
  const buf = parseFloat(side === 'CALL' ? r.call_atr_buf : r.put_atr_buf) || 0;
  return { iv, cr, K, buf };
}
function score(row, side) {
  const { iv, cr, buf } = pickFields(row, side);
  // Composite: weight IV (premium driver) × buffer (margin of safety) × credit
  return iv * 100 * Math.min(buf, 4) * cr;
}

function processSide(filename, side) {
  const { header, rows } = readCsv(path.join(OUT, filename));
  console.log(`\n=== ${side} side: ${rows.length} candidates ===`);
  const surviving = [];
  const flagged = [];
  for (const r of rows) {
    const ed = earningsInWindow(r.ticker);
    if (ed) {
      flagged.push({ ...r, earnings_date: ed });
    } else {
      r.earnings_date = earningsByT[r.ticker]?.next_date ?? '';
      r._score = score(r, side);
      surviving.push(r);
    }
  }
  surviving.sort((a, b) => b._score - a._score);

  console.log(`  excluded (earnings ${HOLD_START}..${HOLD_END}): ${flagged.length}`);
  for (const f of flagged) {
    const fp = pickFields(f, side);
    console.log(`    ${f.ticker.padEnd(6)} ${f.earnings_date}  K=${fp.K} cr=${fp.cr.toFixed(2)} buf=${fp.buf} iv=${(fp.iv*100).toFixed(0)}%`);
  }
  console.log(`  surviving: ${surviving.length}`);
  console.log(`  top 25 by composite score (iv × buf × credit):`);
  console.log('  TKR    PX     IV%  HVR   K       CR    BUF   ED         Name');
  for (const r of surviving.slice(0, 25)) {
    const ed = r.earnings_date || '—';
    const fp = pickFields(r, side);
    const ivpct = (fp.iv * 100).toFixed(0);
    const px = parseFloat(r.price).toFixed(2);
    const hvR = String(Math.round(parseFloat(r.hv_rank) || 0));
    console.log(
      `  ${r.ticker.padEnd(6)} ${px.padStart(6)} ${ivpct.padStart(4)} ${hvR.padStart(3)} ` +
      `${String(fp.K).padStart(5)} ${fp.cr.toFixed(2).padStart(5)} ${fp.buf.toFixed(2).padStart(5)}  ${ed.padEnd(10)} ${r.name ?? ''}`
    );
  }
  // Persist
  const outCols = [...header, 'earnings_date', '_score'];
  writeCsv(path.join(OUT, filename.replace('_refined.csv', '_no_earnings.csv')), surviving, outCols);
}

processSide('shortlist_calls_refined.csv', 'CALL');
processSide('shortlist_puts_refined.csv', 'PUT');
