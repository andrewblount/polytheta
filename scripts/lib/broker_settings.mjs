import postgres from 'postgres';
import { validateBrokerSettings } from '../../shared/broker-settings.mjs';
export async function loadBrokerSettings() {
  const url = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Database unavailable; cannot verify current trading settings');
  const sql = postgres(url, { max: 1 });
  try { const rows = await sql`select value from app_settings where key='broker'`; return validateBrokerSettings(rows[0]?.value ?? {}); }
  finally { await sql.end(); }
}
