#!/usr/bin/env node
// Read-only Schwab account snapshot → posted to the site for the briefings.
//
// Runs on the Mac so Schwab credentials NEVER leave this machine. Reads from
// .env.local: SCHWAB_APP_KEY, SCHWAB_APP_SECRET, SCHWAB_REFRESH_TOKEN,
// SCHWAB_ACCOUNT_HASH (same variables the options-ladder tool uses). Exits
// quietly when they're absent — the briefings simply omit actuals.
//
// NOTE: Schwab refresh tokens expire every 7 days and renewing one requires
// an interactive login. When the token is dead this script logs the failure
// and exits; re-run the ladder tool's auth flow to mint a fresh token.
//
// This script only ever calls GET /trader/v1/accounts — it cannot place,
// modify, or cancel anything.

import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(REPO_ROOT, '.env.local')); } catch { /* optional */ }

const APP_KEY = process.env.SCHWAB_APP_KEY;
const APP_SECRET = process.env.SCHWAB_APP_SECRET;
const REFRESH_TOKEN = process.env.SCHWAB_REFRESH_TOKEN;
const API_BASE = process.env.SCHWAB_API_BASE || 'https://api.schwabapi.com';
const SITE = process.env.POLYTHETA_API_BASE || 'https://polytheta.com';
const SITE_TOKEN = process.env.MOBILE_API_TOKEN;

if (!APP_KEY || !APP_SECRET || !REFRESH_TOKEN) {
  console.log('Schwab credentials not configured in .env.local — skipping (briefings omit actuals).');
  process.exit(0);
}

// OAuth refresh
const tokenRes = await fetch(`${API_BASE}/v1/oauth/token`, {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }),
});
if (!tokenRes.ok) {
  console.error(`Schwab token refresh failed (${tokenRes.status}) — the 7-day refresh token has likely expired. Re-run the ladder auth flow.`);
  process.exit(1);
}
const { access_token } = await tokenRes.json();

const acctRes = await fetch(`${API_BASE}/trader/v1/accounts`, {
  headers: { Authorization: `Bearer ${access_token}` },
});
if (!acctRes.ok) {
  console.error(`Schwab accounts fetch failed (${acctRes.status}).`);
  process.exit(1);
}
const accounts = await acctRes.json();
const acct = accounts?.[0]?.securitiesAccount ?? accounts?.[0];
const bal = acct?.currentBalances ?? {};
const initBal = acct?.initialBalances ?? {};
const liquidationValue = bal.liquidationValue ?? initBal.liquidationValue ?? null;
const equity = bal.equity ?? bal.cashBalance ?? null;
const dayPl =
  liquidationValue != null && initBal.liquidationValue != null
    ? liquidationValue - initBal.liquidationValue
    : null;

console.log(`Schwab: liq $${liquidationValue?.toLocaleString?.() ?? '?'} day P&L ${dayPl?.toLocaleString?.() ?? '?'}`);

const post = await fetch(`${SITE}/api/mobile/schwab-snapshot`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${SITE_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    liquidationValue,
    equity,
    dayPl,
    raw: { balances: bal, initialBalances: initBal, type: acct?.type ?? null },
  }),
});
console.log(post.ok ? 'snapshot posted' : `post failed: ${post.status}`);
