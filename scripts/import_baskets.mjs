#!/usr/bin/env node
// Load orchestrator-generated baskets into the Neon DB behind polytheta.com.
//
//   node scripts/import_baskets.mjs                 # import every proposal on disk
//   node scripts/import_baskets.mjs --date 2026-07-20
//   node scripts/import_baskets.mjs --latest        # only the most recent
//   node scripts/import_baskets.mjs --dry-run
//
// The newest imported basket is marked `published` (that is what the member
// dashboard and /app/baskets/current read); everything older is `archived`.
//
// Requires NETLIFY_DATABASE_URL or DATABASE_URL in the environment.

import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { importProposal, findProposals } from './lib/import_proposal.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const out = { dryRun: false, latest: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') out.date = argv[++i];
    else if (a === '--latest') out.latest = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/import_baskets.mjs [--date YYYY-MM-DD] [--latest] [--dry-run]',
      );
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv);

let proposals = findProposals(REPO_ROOT);
if (!proposals.length) {
  console.error('No basket_proposal.json files found under baskets/.');
  process.exit(1);
}
if (args.date) proposals = proposals.filter((p) => p.date === args.date);
if (args.latest) proposals = proposals.slice(-1);
if (!proposals.length) {
  console.error(`No proposal matched${args.date ? ` --date ${args.date}` : ''}.`);
  process.exit(1);
}

console.log(`Found ${proposals.length} proposal(s): ${proposals.map((p) => p.date).join(', ')}`);

if (args.dryRun) {
  console.log('--dry-run: nothing written.');
  process.exit(0);
}

const url =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;
if (!url) {
  console.error('Set NETLIFY_DATABASE_URL (or DATABASE_URL) before importing.');
  process.exit(1);
}
const sql = neon(url);

const newest = proposals[proposals.length - 1].date;
const results = [];

for (const p of proposals) {
  const publish = p.date === newest;
  try {
    const r = await importProposal(p.file, { publish, sql });
    results.push(r);
    console.log(
      `  ${r.basketDate}  ${String(r.status).padEnd(9)} ${r.positions} positions  ` +
        `margin $${r.totalMargin.toLocaleString()}  credit $${r.totalCredit.toLocaleString()}`,
    );
  } catch (err) {
    console.error(`  ${p.date}  FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

// Anything already in the DB that we did not just publish gets archived, so
// there is exactly one published basket at a time.
if (results.length) {
  const publishedSlug = `weekly-basket-${newest}`;
  await sql.query(`update baskets set status='archived', updated_at=now() where slug <> $1 and status='published'`, [
    publishedSlug,
  ]);
  console.log(`\nPublished: ${publishedSlug} (all others archived)`);
}

console.log(`Imported ${results.length}/${proposals.length} basket(s).`);
