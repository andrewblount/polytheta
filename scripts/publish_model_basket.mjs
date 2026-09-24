#!/usr/bin/env node
// Publish a finalized model basket proposal file to the database.
//   node scripts/publish_model_basket.mjs baskets/2026-09-21/data/basket_proposal.json [--archive]
import path from 'node:path';
import { importProposal } from './lib/import_proposal.mjs';
const root = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply values */ }
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!files.length) { console.log('Usage: node scripts/publish_model_basket.mjs <basket_proposal.json> [...]'); process.exit(1); }
for (const file of files) {
  const result = await importProposal(path.resolve(file), { publish: !process.argv.includes('--archive') });
  console.log(`${result.slug}: ${result.status}, ${result.positions} positions${result.unchanged ? ' (already stored)' : ''}`);
}
