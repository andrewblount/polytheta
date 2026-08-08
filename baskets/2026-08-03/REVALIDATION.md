# Monday Revalidation — 2026-08-03

Checked 2026-08-03T16:30:07.476Z against the Sunday proposal. **2 pick(s) flagged.**

| ticker | side | K | proposal px | live | drift | live ATR buf | verdict |
|--------|------|---|------------:|-----:|------:|-------------:|---------|
| DJT | call | 11 | 10.05 | 10.05 | 0% | 1.4 | OK |
| RIVN | call | 16.5 | 15.27 | 15.505 | 1.5% | 1.03 | OK |
| HOOD | call | 94 | 86.64 | 91.745 | 5.9% | 0.37 | BUFFER GONE — 0.37x ATR remaining (floor 1x), skip or re-strike |
| MSTR | call | 100 | 93.19 | 95.08 | 2% | 0.86 | BUFFER GONE — 0.86x ATR remaining (floor 1x), skip or re-strike |

Flagged names violate the entry assumptions the basket was built on. Re-strike from the live chain (respecting delta 0.15–0.20, spread ≤ $0.15, put buffer ≥ 2x ATR) or drop the name.