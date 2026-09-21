#!/usr/bin/env node
// IB pre-entry heartbeat.
//
// The Monday pipeline only publishes after a live IB final-check. If IB Gateway
// is down, logged into the wrong account type, or on the wrong port, that check
// fails and the week is silently skipped. This job runs BEFORE the entry window
// (Sunday evening + Monday early morning) and performs the same connection +
// account-mode validation the pipeline performs, then alerts (email + iMessage)
// ONLY on failure so the problem can be fixed before the window opens.
//
// Read-only: it never previews or places orders. Uses its own client ID so it
// never collides with the execution worker (96) or market-data reads (97).
//
// Usage: node scripts/ib_heartbeat.mjs [--dry-run] [--notify-ok]
//   --dry-run    run the check and print what would be sent, without sending
//   --notify-ok  also send a short "IB ready" note on success
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadBrokerSettings } from './lib/broker_settings.mjs';
import { createBroker } from './broker/index.mjs';

const root = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply values */ }
const dryRun = process.argv.includes('--dry-run');
const notifyOk = process.argv.includes('--notify-ok');
const env = process.env;
const stamp = () => new Date().toISOString();
const HARD_TIMEOUT_MS = 45000;

function hint(reason) {
  const r = String(reason);
  if (/paper account|IBKR_PAPER_ACCOUNT_ID|account mode does not match|does not match the configured IB account|not authorized by this session/i.test(r)) {
    return 'IB Gateway is logged into the wrong account type for the configured mode. Log OUT of IB Gateway and log back in with the correct mode selected on the login screen (Paper Trading for a DU account, Live for a U account), then leave it running.';
  }
  if (/timed out|ECONNREFUSED|ECONNRESET|connect|not running|socket/i.test(r)) {
    return 'IB Gateway is not reachable on the configured host/port. Start IB Gateway, log in, and confirm its API socket port matches Settings (twsPort).';
  }
  if (/Database unavailable/i.test(r)) {
    return 'Could not read trading settings from the database. Check the DB URL in .env.local and network access.';
  }
  return 'Fix IB Gateway so the pipeline can connect before the Monday entry window.';
}

async function sendEmail(subject, text) {
  if (!env.SENDGRID_API_KEY || !env.SENDGRID_FROM_EMAIL) { console.log('email skipped: SendGrid not configured'); return; }
  const to = env.STOP_ALERT_EMAIL || env.ACCESS_REQUEST_NOTIFY_EMAIL || 'ablount@bluecielo.com';
  if (dryRun) { console.log(`[dry-run] would email ${to}: ${subject}`); return; }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject }],
      from: { email: env.SENDGRID_FROM_EMAIL },
      content: [{ type: 'text/plain', value: text }],
    }),
  });
  console.log(res.ok ? `emailed ${to}` : `email failed: ${res.status} ${await res.text()}`);
}

function sendIMessage(text) {
  if (!env.ALERT_IMESSAGE_TO) { console.log('iMessage skipped: ALERT_IMESSAGE_TO not set'); return; }
  if (dryRun) { console.log(`[dry-run] would iMessage ${env.ALERT_IMESSAGE_TO}: ${text}`); return; }
  try {
    execFileSync('osascript', ['-e',
      `tell application "Messages" to send ${JSON.stringify(text)} to participant ${JSON.stringify(env.ALERT_IMESSAGE_TO)} of (1st account whose service type = iMessage)`,
    ], { timeout: 20000 });
    console.log(`iMessaged ${env.ALERT_IMESSAGE_TO}`);
  } catch (err) { console.error('iMessage failed:', err.message); }
}

async function check() {
  const settings = await loadBrokerSettings();
  settingsForMsg = settings;
  const clientId = Number(env.IBKR_HEARTBEAT_CLIENT_ID ?? 98);
  if (settings.connection === 'tws' && (!Number.isInteger(clientId) || clientId < 1 || clientId === settings.twsClientId)) {
    throw new Error('IBKR_HEARTBEAT_CLIENT_ID must be valid and different from the execution client ID');
  }
  const broker = createBroker({ ...settings, twsClientId: clientId }, env);
  try {
    const health = await broker.connect();
    if (health.mode !== settings.accountMode) throw new Error(`IB account mode ${health.mode} does not match Settings (${settings.accountMode})`);
    return { settings, health, account: broker.account };
  } finally { try { broker.disconnect(); } catch { /* already closed */ } }
}

const target = () => new Promise((_, reject) => setTimeout(() => reject(new Error('IB heartbeat timed out (gateway not responding)')), HARD_TIMEOUT_MS));

let settingsForMsg = null;
try {
  const { settings, health, account } = await Promise.race([check(), target()]);
  settingsForMsg = settings;
  const where = settings.connection === 'web-api' ? settings.webApiUrl : `${settings.twsHost}:${settings.twsPort}`;
  const line = `IB heartbeat OK ${stamp()} — ${health.mode} account ${account} via ${settings.connection} (${where}); entry window Mon ${settings.mondayEntryStart}–${settings.mondayEntryEnd} ET`;
  console.log(line);
  if (notifyOk) { await sendEmail('Polytheta: IB ready for Monday', line); sendIMessage(`Polytheta: IB ready for Monday — ${health.mode} ${account}.`); }
  process.exit(0);
} catch (error) {
  const reason = error?.message ?? String(error);
  const fix = hint(reason);
  const win = settingsForMsg ? `Mon ${settingsForMsg.mondayEntryStart}–${settingsForMsg.mondayEntryEnd} ET` : 'the Monday entry window';
  const subject = 'Polytheta ALERT: IB not ready — Monday basket will be SKIPPED unless fixed';
  const body = [
    `IB pre-entry heartbeat FAILED at ${stamp()}.`,
    '',
    `Reason: ${reason}`,
    '',
    `What to do: ${fix}`,
    '',
    `If this is not fixed before ${win}, the weekly basket will NOT publish (the pipeline refuses to publish without a live IB check).`,
    '',
    `Re-run to confirm: node scripts/ib_heartbeat.mjs`,
  ].join('\n');
  console.error(body);
  await sendEmail(subject, body);
  sendIMessage(`Polytheta ALERT: IB not ready for Monday — ${reason}. ${fix}`);
  process.exit(1);
}
