import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('baskets/2026-06-29/data/earnings_dates.json','utf8'));
const HOLD_START='2026-06-29', HOLD_END='2026-07-02';
const flagged = Object.values(data).filter(r=>r.next_date && r.next_date>=HOLD_START && r.next_date<=HOLD_END);
console.log(`inside ${HOLD_START}..${HOLD_END}: ${flagged.length}`);
for (const r of flagged.sort((a,b)=>a.next_date.localeCompare(b.next_date))) {
  console.log(`  ${r.ticker.padEnd(6)} ${r.next_date} src=${r.source?.join('+')}`);
}
