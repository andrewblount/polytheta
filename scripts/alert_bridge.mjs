#!/usr/bin/env node
// iMessage bridge for cloud alerts.
//
// The hourly sync on Netlify writes actionable alerts (radar exit signals,
// adverse-move heads-ups) to the DB and emails them. This script runs on the
// Mac every 10 minutes via launchd, polls /api/mobile/alerts for anything
// new, and sends each one as an iMessage to ALERT_IMESSAGE_TO so it lands on
// iPhone/iPad/Watch immediately. State (last-seen timestamp) is kept locally.
//
//   node scripts/alert_bridge.mjs           # poll + send
//   node scripts/alert_bridge.mjs --test    # send a test iMessage and exit

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(REPO_ROOT, '.env.local')); } catch { /* optional */ }

const BASE = process.env.POLYTHETA_API_BASE || 'https://polytheta.com';
const TOKEN = process.env.MOBILE_API_TOKEN || '';
const TO = process.env.ALERT_IMESSAGE_TO || '';
const STATE_FILE = path.join(REPO_ROOT, 'scripts', 'launchd', '.alert_bridge_state.json');

function sendIMessage(text) {
  execFileSync('osascript', ['-e',
    `tell application "Messages" to send ${JSON.stringify(text)} to participant ${JSON.stringify(TO)} of (1st account whose service type = iMessage)`,
  ]);
}

if (!TO) { console.error('ALERT_IMESSAGE_TO not set in .env.local'); process.exit(1); }

if (process.argv.includes('--test')) {
  sendIMessage('✅ Polytheta alerts connected. Radar exit signals and adverse-move heads-ups will arrive here.');
  console.log('test iMessage sent');
  process.exit(0);
}

if (!TOKEN) { console.error('MOBILE_API_TOKEN not set in .env.local'); process.exit(1); }

let state = { since: new Date(Date.now() - 6 * 3600 * 1000).toISOString() };
if (fs.existsSync(STATE_FILE)) {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* keep default */ }
}

const res = await fetch(`${BASE}/api/mobile/alerts?since=${encodeURIComponent(state.since)}`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
if (!res.ok) {
  console.error(`alerts fetch failed: ${res.status}`);
  process.exit(1);
}
const { alerts } = await res.json();
if (!alerts?.length) { console.log('no new alerts'); process.exit(0); }

for (const a of alerts) {
  const prefix = a.meta?.kind === 'radar' ? '🚨' : '⚠️';
  try {
    sendIMessage(`${prefix} ${a.message}`);
    state.since = a.at;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    console.log(`sent: ${a.message.slice(0, 80)}`);
  } catch (err) {
    console.error(`iMessage failed (will retry next poll): ${err.message}`);
    break; // keep `since` at last success so this alert retries
  }
}
