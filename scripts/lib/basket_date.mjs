// Small helpers for basket date arithmetic.
// A basket_date is the Monday of the trade week. expiry is the following Friday.
// Both are ISO date strings (YYYY-MM-DD) in UTC.

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function nextOrTodayWeekday(d, weekday /* 0=Sun..6=Sat */) {
  const out = new Date(d);
  const day = out.getUTCDay();
  const add = (weekday - day + 7) % 7;
  out.setUTCDate(out.getUTCDate() + add);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

// Given "now", return the basket_date (Monday of the *upcoming* trading week,
// or the current week if today is Sat/Sun/Mon). Convention: if today is
// Tue–Fri, jump to the next Monday, because the current week's basket has
// already been decided.
export function deriveBasketDate(now = new Date()) {
  const dow = now.getUTCDay(); // 0=Sun..6=Sat
  const base = new Date(now);
  base.setUTCHours(0, 0, 0, 0);
  let target;
  if (dow === 0 || dow === 6) {
    // Sat/Sun -> upcoming Monday
    target = nextOrTodayWeekday(base, 1);
    if (target.getTime() === base.getTime()) target.setUTCDate(target.getUTCDate() + 7);
    if (dow === 6) target.setUTCDate(target.getUTCDate() + 2);
    else target.setUTCDate(target.getUTCDate() + 1);
    // Simpler: just start from Sat/Sun and add days until Monday.
    target = new Date(base);
    target.setUTCDate(target.getUTCDate() + ((1 - dow + 7) % 7 || 7));
  } else if (dow === 1) {
    target = base; // today is Monday
  } else {
    // Tue-Fri -> next Monday
    target = new Date(base);
    target.setUTCDate(target.getUTCDate() + ((1 - dow + 7) % 7));
  }
  target.setUTCHours(0, 0, 0, 0);
  return isoDate(target);
}

export function expiryFromBasketDate(basketDateIso) {
  const d = new Date(basketDateIso + 'T00:00:00Z');
  // Basket Monday -> Friday of the same week
  d.setUTCDate(d.getUTCDate() + 4);
  return isoDate(d);
}

// Simple CLI: `node scripts/lib/basket_date.mjs` prints derived basket + expiry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const now = process.argv[2] ? new Date(process.argv[2]) : new Date();
  const b = deriveBasketDate(now);
  const e = expiryFromBasketDate(b);
  console.log(JSON.stringify({ now: now.toISOString(), basket_date: b, expiry: e }));
}
