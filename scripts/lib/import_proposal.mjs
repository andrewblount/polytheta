// Import a basket_proposal.json produced by run_weekly_basket.mjs into the
// Neon database that backs the polytheta.com site.
//
// The orchestrator writes proposals to baskets/<date>/data/basket_proposal.json
// but nothing ever loaded them into the DB, so the site kept serving whatever
// was last entered by hand through the admin editor. This closes that gap.
//
// Idempotent: re-importing the same basket_date updates in place (matched on
// slug) rather than creating duplicates.

import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const DISCLAIMER =
  'I am not a financial advisor, registered broker, or investment professional. ' +
  'This is not financial, tax, legal, or investment advice. Naked call and naked put ' +
  'selling carries extreme risk of rapid, total, or greater-than-account loss. ' +
  'Always verify every price, chain, margin requirement, and order live on your broker ' +
  'platform before submitting any real trade. Test every concept in a paper account first.';

// Fields the manual-era baskets carried but the auto-orchestrator does not
// compute. They are NOT NULL in the schema, so they get zero — sourceMetadata
// records that they were never evaluated so the UI can tell the difference
// between "zero" and "unknown".
const NOT_EVALUATED = {
  shortInterestPctFloat: 0,
  fanScore: 0,
  glassdoorScore: 0,
  buybackScore: 0,
};

function requireUrl() {
  const url =
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error(
      'No database URL. Set NETLIFY_DATABASE_URL (or DATABASE_URL) before importing.',
    );
  }
  return url;
}

function gsrsNoteFrom(proposal) {
  const c = proposal.gsrs_components ?? {};
  const parts = Object.entries(c).map(([k, v]) => `${k} ${v}`);
  const band =
    proposal.gsrs < 3
      ? 'below 3.0 — full sizing available'
      : proposal.gsrs < 5
        ? '3–5 band — put sizing constrained, doubles prohibited on puts'
        : '5+ — elevated stress, sizing materially constrained';
  return `GSRS ${proposal.gsrs} (${band}). Components: ${parts.join(', ')}.`;
}

function narrativeFrom(proposal) {
  const m = proposal.macro ?? {};
  const bits = [
    `VIX ${m.VIX}${m.VIX_prev != null ? ` (prev ${m.VIX_prev})` : ''}`,
    `SKEW ${m.SKEW}`,
    `HY OAS ${m.HY_OAS}%`,
    `MOVE ${m.MOVE}`,
    `P/C ${m.PC}`,
  ];
  const src = proposal.tv_macros_source ?? {};
  const srcNote = src.hy_oas || src.pc ? ` Sources: HY OAS ${src.hy_oas ?? 'n/a'}, P/C ${src.pc ?? 'n/a'}.` : '';
  return `${bits.join(' | ')}.${srcNote} ${proposal.filter_note ?? ''}`.trim();
}

function thesisBulletsFrom(pick) {
  const out = [];
  if (pick.iv != null) out.push(`Option IV ${(pick.iv * 100).toFixed(0)}%`);
  if (pick.ivAtm != null) out.push(`ATM IV ${(pick.ivAtm * 100).toFixed(0)}%`);
  if (pick.hvR != null) out.push(`HV rank ${pick.hvR}`);
  if (pick.buf != null) out.push(`${pick.buf}x ATR buffer`);
  if (pick.atr != null) out.push(`14d ATR ${pick.atr}`);
  if (pick.spread != null) out.push(`Bid/ask spread ${pick.spread}`);
  if (pick.bid != null && pick.ask != null) out.push(`Bid ${pick.bid} / Ask ${pick.ask}`);
  if (pick.family) out.push(`Family: ${pick.family}`);
  return out;
}

function cautionFlagsFrom(pick) {
  const out = [];
  if (pick.earnings_date) {
    out.push(
      pick.earnings_clear
        ? `Earnings ${pick.earnings_date} — outside hold window`
        : `EARNINGS ${pick.earnings_date} INSIDE HOLD WINDOW`,
    );
  }
  if (pick.buf != null && pick.buf < 1.5) out.push(`Thin ATR buffer (${pick.buf}x)`);
  if (pick.spread != null && pick.bid && pick.spread / pick.bid > 0.5) {
    out.push('Wide bid/ask relative to credit');
  }
  return out;
}

function orderBlocks(picks, expiry) {
  const fmtDate = new Date(`${expiry}T00:00:00Z`);
  const schwabDate = fmtDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const yr = `'${String(fmtDate.getUTCFullYear()).slice(2)}`;
  const blocks = [];
  for (const side of ['call', 'put']) {
    const legs = picks.filter((p) => p.side === side);
    if (!legs.length) continue;
    const type = side === 'call' ? 'Call' : 'Put';
    blocks.push({
      broker: 'IBKR TWS',
      side,
      title: `${type.toUpperCase()} SIDE`,
      orderText: legs
        .map(
          (p) =>
            `Sell to Open ${p.contracts} ${p.ticker} ${expiry} ${p.K} ${type} – Limit ${p.cr.toFixed(2)} – GTC – Portfolio Margin`,
        )
        .join('\n'),
    });
    blocks.push({
      broker: 'Schwab StreetSmart Edge',
      side,
      title: `${type.toUpperCase()} SIDE`,
      orderText: legs
        .map(
          (p) =>
            `Sell to Open ${p.contracts} ${p.ticker} ${schwabDate} ${yr} $${p.K} ${type} @ Limit ${p.cr.toFixed(2)}`,
        )
        .join('\n'),
    });
  }
  return blocks;
}

const RULES = [
  ['hard-stop', '25% loss on any single name', 'Close that name.', 0],
  ['hard-stop', '30% total portfolio drawdown', 'Close everything.', 1],
  ['hard-stop', 'Acquisition radar signal (call side)', 'Immediate full exit on that name.', 2],
  ['hard-stop', 'Downside-gap radar signal (put side)', 'Immediate full exit on that name.', 3],
  ['profit-target', 'Close at 50–70% of collected credit', 'Per position.', 4],
  ['profit-target', 'Daily 1% account gain target', 'Whichever comes first.', 5],
  [
    'note',
    'Auto-generated basket',
    'Produced by scripts/run_weekly_basket.mjs. Short interest, fan score, Glassdoor, and buyback signals were not evaluated for these picks — selection is driven by IV, ATR buffer, OTM volume, and earnings clearance. Verify all strikes and credits against live broker chains before trading.',
    6,
  ],
];

export async function importProposal(proposalPath, { publish = false, sql: injected } = {}) {
  const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
  const sql = injected ?? neon(requireUrl());

  const basketDate = proposal.basket_date;
  const expiry = proposal.expiry;
  const picks = proposal.picks ?? [];
  const totals = proposal.totals ?? {};
  const slug = `weekly-basket-${basketDate}`;
  const prettyDate = new Date(`${basketDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const totalMargin = (totals.callMargin ?? 0) + (totals.putMargin ?? 0);
  const totalCredit = (totals.callCredit ?? 0) + (totals.putCredit ?? 0);
  const cashNeeded = Math.round(totalMargin / 4); // 4x portfolio-margin leverage
  const callCount = picks.filter((p) => p.side === 'call').length;
  const putCount = picks.filter((p) => p.side === 'put').length;

  // Daily theta approximated as credit spread evenly across the hold window.
  const holdDays = Math.max(
    1,
    Math.round(
      (new Date(`${expiry}T00:00:00Z`) - new Date(`${basketDate}T00:00:00Z`)) / 86400000,
    ),
  );
  const dailyTheta = Math.round(totalCredit / holdDays);

  const quickSummary = [
    { label: 'GSRS', value: String(proposal.gsrs) },
    { label: 'Names', value: `${picks.length} (${callCount} call / ${putCount} put)` },
    { label: 'Total margin', value: `$${totalMargin.toLocaleString()}` },
    { label: 'Est. credit', value: `$${totalCredit.toLocaleString()}` },
    {
      label: 'RoM at max profit',
      value: totalMargin ? `${((totalCredit / totalMargin) * 100).toFixed(2)}%` : 'n/a',
    },
  ];

  const commentary = [
    proposal.entry_note,
    proposal.hold_window ? `Hold window: ${proposal.hold_window}.` : null,
    proposal.filter_note,
    proposal.pool_counts
      ? `Candidate pool after filters: ${proposal.pool_counts.calls} calls, ${proposal.pool_counts.puts} puts.`
      : null,
    proposal.earnings_filter_applied
      ? `Earnings filter applied (${proposal.earnings_in_window_count_universe ?? 0} names in window across universe).`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  // ---- baskets (upsert on slug) ----
  const existing = await sql.query('select id from baskets where slug = $1', [slug]);
  const status = publish ? 'published' : 'archived';
  let basketId;

  if (existing.length) {
    basketId = existing[0].id;
    await sql.query(
      `update baskets set title=$2, week_of=$3, publication_date=$4, status=$5, gsrs=$6,
         radar_status=$7, cash_needed=$8, disclaimer=$9, quick_summary=$10, commentary=$11,
         updated_at=now()
       where id=$1`,
      [
        basketId,
        `Weekly Basket — ${prettyDate} Entry`,
        basketDate,
        proposal.generated_ts,
        status,
        proposal.gsrs,
        'Auto — radars not evaluated',
        cashNeeded,
        DISCLAIMER,
        JSON.stringify(quickSummary),
        commentary,
      ],
    );
    // Replace children so re-imports stay clean.
    for (const t of [
      'performance_snapshots',
      'position_alerts',
      'thesis_signals',
      'basket_rules',
      'broker_order_blocks',
      'positions',
      'market_conditions',
      'basket_metrics',
    ]) {
      await sql.query(`delete from ${t} where basket_id = $1`, [basketId]);
    }
  } else {
    const ins = await sql.query(
      `insert into baskets
         (title, slug, week_of, publication_date, status, gsrs, radar_status, cash_needed,
          disclaimer, quick_summary, commentary)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        `Weekly Basket — ${prettyDate} Entry`,
        slug,
        basketDate,
        proposal.generated_ts,
        status,
        proposal.gsrs,
        'Auto — radars not evaluated',
        cashNeeded,
        DISCLAIMER,
        JSON.stringify(quickSummary),
        commentary,
      ],
    );
    basketId = ins[0].id;
  }

  // ---- market_conditions (1:1, required or the basket won't render) ----
  const m = proposal.macro ?? {};
  await sql.query(
    `insert into market_conditions
       (basket_id, gsrs_note, vix, skew, hy_oas, move, put_call_ratio,
        acquisition_radar_status, downside_gap_radar_status, narrative)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      basketId,
      gsrsNoteFrom(proposal),
      m.VIX ?? 0,
      m.SKEW ?? 0,
      m.HY_OAS ?? 0,
      m.MOVE ?? 0,
      m.PC ?? 0,
      'Not evaluated (auto-generated basket)',
      'Not evaluated (auto-generated basket)',
      narrativeFrom(proposal),
    ],
  );

  // ---- basket_metrics (1:1, also required) ----
  await sql.query(
    `insert into basket_metrics
       (basket_id, total_names, call_count, put_count, total_margin, cash_needed,
        total_estimated_credit, daily_theta, concentration_note, gsrs_constraint_note, other_metrics)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      basketId,
      picks.length,
      callCount,
      putCount,
      totalMargin,
      cashNeeded,
      totalCredit,
      dailyTheta,
      `Family cap of 2 names enforced at selection. Families present: ${[...new Set(picks.map((p) => p.family))].join(', ') || 'n/a'}.`,
      gsrsNoteFrom(proposal),
      JSON.stringify({
        rom_pct: totalMargin ? Number(((totalCredit / totalMargin) * 100).toFixed(2)) : null,
        hold_days: holdDays,
        pool_counts: proposal.pool_counts ?? null,
        generated_ts: proposal.generated_ts,
        source: 'run_weekly_basket.mjs',
      }),
    ],
  );

  // ---- positions ----
  const entryTs = proposal.generated_ts;
  let sortOrder = 0;
  const positionIds = [];
  for (const p of picks) {
    const r = await sql.query(
      `insert into positions
         (basket_id, side, ticker, entry_underlying_price, iv_rank, short_interest_pct_float,
          fan_score, glassdoor_score, buyback_score, strike, option_type, expiry, delta,
          estimated_entry_credit, contracts, margin, atr_14d, buffer, thesis_summary,
          thesis_bullets, caution_flags, entry_timestamp, source_metadata, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       returning id`,
      [
        basketId,
        p.side,
        p.ticker,
        p.px,
        p.hvR ?? 0, // HV rank stands in for IV rank; the orchestrator reports hvR
        NOT_EVALUATED.shortInterestPctFloat,
        NOT_EVALUATED.fanScore,
        NOT_EVALUATED.glassdoorScore,
        NOT_EVALUATED.buybackScore,
        p.K,
        p.side,
        expiry,
        Math.abs(p.delta ?? 0),
        p.cr,
        p.contracts,
        p.margin,
        p.atr ?? null,
        p.buf != null ? `${p.buf}x ATR` : null,
        p.thesis ?? 'Auto-selected.',
        JSON.stringify(thesisBulletsFrom(p)),
        JSON.stringify(cautionFlagsFrom(p)),
        entryTs,
        JSON.stringify({
          ...p,
          _not_evaluated: ['shortInterestPctFloat', 'fanScore', 'glassdoorScore', 'buybackScore'],
        }),
        sortOrder++,
      ],
    );
    positionIds.push({ id: r[0].id, pick: p });
  }

  // ---- position_alerts (break levels from ATR buffer) ----
  let alertOrder = 0;
  for (const { id, pick } of positionIds) {
    const atr = pick.atr ?? 0;
    if (!atr) continue;
    const dir = pick.side === 'call' ? 1 : -1;
    for (const [n, mult] of [
      [1, 0.5],
      [2, 1.0],
    ]) {
      await sql.query(
        `insert into position_alerts
           (basket_id, position_id, ticker, side, label, threshold_value, protocol_note, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          basketId,
          id,
          pick.ticker,
          pick.side,
          `Break #${n}`,
          (pick.px + dir * atr * mult).toFixed(2),
          n === 1 ? 'Double down (call side only).' : 'Double and prepare exit.',
          alertOrder++,
        ],
      );
    }
  }

  // ---- basket_rules ----
  for (const [category, title, body, order] of RULES) {
    await sql.query(
      `insert into basket_rules (basket_id, category, title, body, sort_order)
       values ($1,$2,$3,$4,$5)`,
      [basketId, category, title, body, order],
    );
  }

  // ---- broker_order_blocks ----
  for (const b of orderBlocks(picks, expiry)) {
    await sql.query(
      `insert into broker_order_blocks (basket_id, broker, side, title, order_text)
       values ($1,$2,$3,$4,$5)`,
      [basketId, b.broker, b.side, b.title, b.orderText],
    );
  }

  return {
    slug,
    basketId,
    basketDate,
    expiry,
    status,
    positions: picks.length,
    totalMargin,
    totalCredit,
  };
}

export function findProposals(repoRoot) {
  const dir = path.join(repoRoot, 'baskets');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .map((n) => ({ date: n, file: path.join(dir, n, 'data', 'basket_proposal.json') }))
    .filter((x) => fs.existsSync(x.file))
    .sort((a, b) => a.date.localeCompare(b.date));
}
