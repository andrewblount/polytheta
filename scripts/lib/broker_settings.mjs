import postgres from 'postgres';
import { validateBrokerSettings } from '../../shared/broker-settings.mjs';
import { validateModelSettings, modelPolicy } from '../../shared/model-settings.mjs';
export async function loadBrokerSettings() {
  const url = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Database unavailable; cannot verify current trading settings');
  const sql = postgres(url, { max: 1 });
  try { const rows = await sql`select value from app_settings where key='broker'`; return validateBrokerSettings(rows[0]?.value ?? {}); }
  finally { await sql.end(); }
}
export async function loadBrokerEquity() {
  const url = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Database unavailable; cannot read the published IB account equity');
  const sql = postgres(url, { max: 1 });
  try { const rows = await sql`select value from app_settings where key='broker_equity'`; return rows[0]?.value ?? null; }
  finally { await sql.end(); }
}
export async function loadModelSettings() {
  const url = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Database unavailable; cannot read the model settings');
  const sql = postgres(url, { max: 1 });
  try { const rows = await sql`select value from app_settings where key='model'`; return validateModelSettings(rows[0]?.value ?? {}); }
  finally { await sql.end(); }
}
// Broker settings with the model's own sizing laid over them: what the weekly
// model basket is selected and sized under.
export async function loadModelPolicy() {
  const [broker, model] = await Promise.all([loadBrokerSettings(), loadModelSettings()]);
  return modelPolicy(broker, model);
}
