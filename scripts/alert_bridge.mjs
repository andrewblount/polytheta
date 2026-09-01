#!/usr/bin/env node
// iMessage bridge for cloud alerts.
//
// Polls /api/mobile/alerts and forwards genuinely new ones to iMessage.
// Runs every few minutes via launchd.
//
//   node scripts/alert_bridge.mjs           # poll + send
//   node scripts/alert_bridge.mjs --test    # send a test iMessage and exit
//   node scripts/alert_bridge.mjs --seed    # mark all current alerts as
//                                           # already-delivered (no sends)
//
// Design (rewritten 2026-08-17 after a runaway-duplicate incident):
//   * Dedup by ALERT ID, not by a `since` timestamp. A persisted set of sent
//     IDs guarantees a message is never sent twice, even if a later send in
//     the same batch fails. This is the hard guarantee the old timestamp/break
//     logic lacked.
//   * RECENCY CAP: only alerts newer than MAX_AGE_MIN are ever eligible, so a
//     restart or a backlog can never blast historical briefings.
//   * FAILURE ISOLATION: a failed send (e.g. Messages AppleEvent timeout) is
//     recorded and skipped after MAX_ATTEMPTS tries — it never wedges the
//     queue into re-sending everything.
//   * PER-RUN CAP: at most MAX_PER_RUN sends per invocation, a circuit breaker.
//   * osascript runs with a hard timeout so a hung Messages app can't stall.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(REPO_ROOT, '.env.local')); } catch { /* optional */ }

const BASE = process.env.POLYTHETA_API_BASE || 'https://polytheta.com';
const TOKEN = process.env.MOBILE_API_TOKEN || '';
const TO = process.env.ALERT_IMESSAGE_TO || '';
const STATE_FILE = path.join(REPO_ROOT, 'scripts', 'launchd', '.alert_bridge_state.json');

const MAX_AGE_MIN = 90;   // ignore anything older than this — no backlog blasts
const MAX_PER_RUN = 5;    // circuit breaker
const MAX_ATTEMPTS = 3;   // give up on a message after this many failed sends
const LOOKBACK_MIN = 180; // window we fetch from the API

function sendIMessage(text) {
  // -t 20: hard 20s cap so a slow Messages app can't hang the poll.
  execFileSync('osascript', ['-e',
    `tell application "Messages" to send ${JSON.stringify(text)} to participant ${JSON.stringify(TO)} of (1st account whose service type = iMessage)`,
  ], { timeout: 20000 });
}

// state: { sent: {id: {at, attempts}}, ... } — pruned to recent entries.
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (s && typeof s === 'object' && s.sent) return s;
    } catch { /* fall through */ }
  }
  return { sent: {} };
}
function saveState(state) {
  // Prune entries older than a day so the file stays small.
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [id, v] of Object.entries(state.sent)) {
    if (new Date(v.at).getTime() < cutoff) delete state.sent[id];
  }
  for (const [hash, at] of Object.entries(state.texts ?? {})) {
    if (new Date(at).getTime() < cutoff) delete state.texts[hash];
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

// Second, independent guard after the August runaway: even if the API ever
// hands back the same briefing under a fresh row id, identical TEXT never
// goes out twice in 24h.
function textHash(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}
function textAlreadySent(state, text) {
  return Boolean((state.texts ?? {})[textHash(text)]);
}
function recordText(state, text) {
  state.texts = state.texts ?? {};
  state.texts[textHash(text)] = new Date().toISOString();
}

if (!TO) { console.error('ALERT_IMESSAGE_TO not set in .env.local'); process.exit(1); }

if (process.argv.includes('--test')) {
  sendIMessage('✅ Polytheta alerts connected. Radar and adverse-move alerts arrive here.');
  console.log('test iMessage sent');
  process.exit(0);
}

if (!TOKEN) { console.error('MOBILE_API_TOKEN not set in .env.local'); process.exit(1); }

const state = loadState();
const since = new Date(Date.now() - LOOKBACK_MIN * 60 * 1000).toISOString();
const res = await fetch(`${BASE}/api/mobile/alerts?since=${encodeURIComponent(since)}`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
if (!res.ok) { console.error(`alerts fetch failed: ${res.status}`); process.exit(1); }
const { alerts } = await res.json();

// --seed: record every current alert as delivered without sending anything.
if (process.argv.includes('--seed')) {
  for (const a of alerts ?? []) state.sent[a.id] = { at: new Date().toISOString(), attempts: 0, seeded: true };
  saveState(state);
  console.log(`seeded ${alerts?.length ?? 0} alerts as delivered (no sends)`);
  process.exit(0);
}

if (!alerts?.length) { console.log('no new alerts'); process.exit(0); }

const ageCutoff = Date.now() - MAX_AGE_MIN * 60 * 1000;
let sent = 0;
for (const a of alerts) {
  if (sent >= MAX_PER_RUN) { console.log('per-run cap reached'); break; }
  const prior = state.sent[a.id];
  if (prior && (prior.seeded || prior.attempts >= MAX_ATTEMPTS || prior.delivered)) continue;
  if (new Date(a.at).getTime() < ageCutoff) {
    // Too old to send now — mark delivered so it's never revisited.
    state.sent[a.id] = { at: new Date().toISOString(), attempts: 0, delivered: true, skipped: 'stale' };
    continue;
  }
  // Briefings carry their own ☀️/🌙 mood — the warning triangle made routine
  // scorecards read like incidents. Reserve prefixes for real alerts.
  const kind = a.meta?.kind;
  const prefix = kind === 'radar' ? '🚨 ' : kind === 'briefing' ? '' : '⚠️ ';
  const body = `${prefix}${a.message}`;
  if (textAlreadySent(state, body)) {
    state.sent[a.id] = { at: new Date().toISOString(), attempts: 0, delivered: true, skipped: 'duplicate-text' };
    saveState(state);
    console.log(`skipped duplicate text: ${a.message.slice(0, 60)}`);
    continue;
  }
  try {
    sendIMessage(body);
    state.sent[a.id] = { at: new Date().toISOString(), attempts: (prior?.attempts ?? 0) + 1, delivered: true };
    recordText(state, body);
    saveState(state);
    sent += 1;
    console.log(`sent: ${a.message.slice(0, 70)}`);
  } catch (err) {
    const attempts = (prior?.attempts ?? 0) + 1;
    state.sent[a.id] = { at: new Date().toISOString(), attempts, delivered: false };
    saveState(state);
    console.error(`send failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${err.message.slice(0, 80)}`);
    // Do NOT break — isolate this failure, keep processing others.
  }
}
console.log(`done: ${sent} sent`);
