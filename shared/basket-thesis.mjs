// Trading thesis for a model basket, written from the numbers the model
// actually used. One implementation serves the weekly importer, historical
// rebuilds and the backfill of baskets already in the database, so every
// basket in the archive carries the same kind of thesis.
//
// A thesis is descriptive: it explains what the model saw and why the rules
// selected these contracts. It never claims a forecast the model did not make.
const money = n => `$${Math.round(Number(n)).toLocaleString('en-US')}`;
const pct = (n, digits = 1) => `${Number(n).toFixed(digits)}%`;
const num = (n, digits = 2) => Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : 'n/a';

export function gsrsBand(gsrs) {
  const g = Number(gsrs);
  if (!Number.isFinite(g)) return { band: 'unknown', label: 'GSRS unavailable', putPolicy: 'Put sizing rule could not be evaluated' };
  if (g < 3) return { band: '0-3', label: 'calm regime', putPolicy: 'full put sizing permitted' };
  if (g < 5) return { band: '3-5', label: 'moderate stress', putPolicy: 'put allocation halved, no put doubles' };
  if (g < 7) return { band: '5-7', label: 'elevated stress', putPolicy: 'no new puts' };
  return { band: '7-10', label: 'crisis regime', putPolicy: 'no new puts; hedge recommended' };
}

function regimeParagraph(p) {
  const m = p.macro ?? {};
  const band = gsrsBand(p.gsrs);
  const c = p.gsrs_components ?? {};
  const vixMove = Number.isFinite(Number(m.VIX)) && Number.isFinite(Number(m.VIX_prev))
    ? (Number(m.VIX) - Number(m.VIX_prev) >= 0 ? `up ${num(Number(m.VIX) - Number(m.VIX_prev))}` : `down ${num(Number(m.VIX_prev) - Number(m.VIX))}`) + ' on the day'
    : null;
  const parts = [
    `GSRS ${num(p.gsrs)} (${band.label}, band ${band.band}).`,
    `VIX ${num(m.VIX)}${vixMove ? ` (${vixMove})` : ''}, SKEW ${num(m.SKEW)}, high-yield OAS ${num(m.HY_OAS)}%, MOVE ${num(m.MOVE)}, total put/call ${num(m.PC)}.`,
    Object.keys(c).length ? `Score contributions: VIX ${num(c.vix)}, SKEW ${num(c.skew)}, HY OAS ${num(c.hyoas)}, MOVE ${num(c.move)}, P/C ${num(c.pc)} (weights 40/20/20/10/10).` : null,
    `Implication: ${band.putPolicy}; call side unrestricted.`,
  ];
  return parts.filter(Boolean).join(' ');
}

function selectionParagraph(p) {
  const s = p.allocation_settings ?? {};
  const picks = p.picks ?? [];
  const calls = picks.filter(x => x.side === 'call').length, puts = picks.filter(x => x.side === 'put').length;
  const scale = Number(p.allocation_scale ?? 1);
  const reasons = [];
  if (scale < 1) {
    if (picks.some(x => x.frenzy === 'elevated')) reasons.push('an elevated pre-entry thrust halves the allocation (frenzy guard)');
    if (Number(p.gsrs) >= 3 && puts) reasons.push('GSRS 3–5 with puts halves the allocation');
  }
  const equity = Number(p.model_equity);
  const perTrade = picks[0]?.allocated_capital ?? (Number.isFinite(equity) && picks.length ? equity * Number(s.entryCapitalPct ?? 100) / 100 * scale / picks.length : null);
  const split = s.callAllocationPct != null ? `${s.callAllocationPct}% calls / ${s.putAllocationPct}% puts, at most ${s.maxTrades} trades` : 'configured call/put split';
  const pool = p.pool_counts ? ` The screened pool held ${p.pool_counts.calls} call candidates and ${p.pool_counts.puts} put candidates.` : '';
  return [
    `${picks.length} short option${picks.length === 1 ? '' : 's'} (${calls} call${calls === 1 ? '' : 's'}, ${puts} put${puts === 1 ? '' : 's'}) under the ${split}.`,
    Number.isFinite(equity) ? `Model equity ${money(equity)}${p.model_equity_source ? ` (${p.model_equity_source})` : ''}, allocation scale ${num(scale, 2)}${reasons.length ? ` because ${reasons.join(' and ')}` : ''}; each trade is backed equally${perTrade ? ` with about ${money(perTrade)}` : ''}, contracts rounded down to whole lots.` : null,
    'Screen: single stocks with weekly options, price $8–$100, average volume ≥1.5M, OTM side volume ≥500, positive bid, modeled credit ≥$0.10, spread ≤$0.15, |delta| 0.15–0.20, strike buffer ≥1 ATR for calls and ≥2 ATR for puts; earnings inside the hold window, active call-side buybacks, triggered news radars, extreme upward frenzy, duplicate names and more than two names per family are excluded.' + pool,
    'Ranking: confirmed thesis signals first, then the side criterion (highest option IV for calls, largest market cap for puts); calm names outrank names that just ripped.',
  ].filter(Boolean).join(' ');
}

export function pickThesis(pick, proposal = {}) {
  const side = pick.side === 'call' ? 'short call' : 'short put';
  const otm = Number.isFinite(Number(pick.entry_otm_pct)) ? Number(pick.entry_otm_pct) : (Number(pick.px) > 0 ? (pick.side === 'call' ? Number(pick.K) - Number(pick.px) : Number(pick.px) - Number(pick.K)) / Number(pick.px) * 100 : null);
  const rc = pick.rule_checks ?? {};
  const sig = rc.thesis_signals ?? {};
  const passing = Object.entries(sig).filter(([, v]) => v === 'pass').map(([k]) => k.replace('_', ' '));
  const failing = Object.entries(sig).filter(([, v]) => v === 'fail').map(([k]) => k.replace('_', ' '));
  const bits = [
    `${pick.ticker}${pick.name ? ` (${pick.name})` : ''}: ${side}, strike ${pick.K}, ${Number.isFinite(otm) ? pct(otm) : 'n/a'} OTM from ${Number.isFinite(Number(pick.px)) ? `$${num(pick.px)}` : 'spot'}, |delta| ${num(Math.abs(Number(pick.delta)), 2)}, ${Number.isFinite(Number(pick.buf)) ? `${num(pick.buf)}× ATR` : 'ATR buffer n/a'} (ATR ${num(pick.atr)}).`,
    `Selected for ${Number.isFinite(Number(pick.iv)) ? pct(Number(pick.iv) * 100, 0) : 'n/a'} option IV${pick.hvR != null ? ` with HV rank ${pick.hvR}` : ''}${pick.family && pick.family !== 'other' ? ` in the ${pick.family.replace(/_/g, ' ')} family` : ''}.`,
    `Modeled credit $${num(pick.cr)} per contract × ${pick.contracts} contract${pick.contracts === 1 ? '' : 's'} = ${money(pick.credit)}${Number.isFinite(Number(pick.margin)) ? ` against ${money(pick.margin)} naked margin` : ''}${pick.bid != null && pick.ask != null ? ` (market ${num(pick.bid)}/${num(pick.ask)})` : ''}.`,
    pick.earnings_date ? `Next earnings ${pick.earnings_date}${pick.earnings_clear === false ? ' INSIDE the hold window' : ', outside the hold window'}.` : 'Earnings date verified outside the hold window.',
    pick.si_pct != null ? `Short interest ${num(pick.si_pct, 1)}% of float.` : null,
    passing.length || failing.length ? `Thesis signals: ${passing.length ? `pass ${passing.join(', ')}` : ''}${passing.length && failing.length ? '; ' : ''}${failing.length ? `fail ${failing.join(', ')}` : ''}${rc.thesis_coverage ? ` (${rc.thesis_coverage} known)` : ''}.` : (rc.thesis_coverage ? `Thesis signals ${rc.thesis_coverage} known.` : null),
    pick.frenzy === 'elevated' ? `Frenzy guard: elevated pre-entry thrust (1d ${num(pick.mom?.r1, 1)}%, 3d ${num(pick.mom?.r3, 1)}%, 10d ${num(pick.mom?.r10, 1)}%); allocation halved.` : null,
    pick.entry_pricing?.ivSource ? `Entry credit repriced from the dated reference for elapsed time, current underlying and ${pick.entry_pricing.ivSource}.` : null,
  ];
  void proposal;
  return bits.filter(Boolean).join(' ');
}

function riskParagraph(p) {
  const s = p.allocation_settings ?? {};
  return [
    'Hold to expiry; the weekly tenor is the stop and there is no doubling or averaging down.',
    'Automatic exits only on a credible company-specific news signal (acquisition risk for a short call, a serious downside event for a short put)',
    s.maxAccountLossPct != null ? `or when a ticker's combined loss reaches ${s.maxAccountLossPct}% of the account equity recorded before its entry.` : '.',
    'Expiry is modeled at intrinsic value from the expiry-session close.',
  ].join(' ');
}

function executionParagraph(p) {
  const late = p.late ? ` This basket was priced late: ${p.late_note ?? 'after the scheduled entry window'}` : '';
  const provenance = p.data_provenance === 'reconstructed'
    ? ` Data provenance: RECONSTRUCTED — ${p.reconstruction?.note ?? 'no live option-chain snapshot survived for this week; quotes are modeled'}.`
    : p.data_provenance === 'rebuilt-from-snapshot' ? ` Data provenance: rebuilt after the fact from the option-chain snapshot the model captured at ${p.reconstruction?.snapshot_observed_at ?? 'the time'}.` : '';
  return `Model entry ${p.entry_timestamp ?? p.entry_date ?? p.basket_date}, expiry ${p.expiry}. Modeled credits are midpoints or dated-reference reprices, not fills; the execution service enters only inside its own window with fresh IB quotes, so account results differ from the model by slippage and by whatever it could not execute.${late}${provenance}`;
}

export function basketThesis(proposal) {
  const picks = proposal.picks ?? [];
  const band = gsrsBand(proposal.gsrs);
  const calls = picks.filter(x => x.side === 'call').length, puts = picks.filter(x => x.side === 'put').length;
  const headline = `${calls ? `${calls} short call${calls === 1 ? '' : 's'}` : ''}${calls && puts ? ' and ' : ''}${puts ? `${puts} short put${puts === 1 ? '' : 's'}` : ''} for expiry ${proposal.expiry}, selected in a ${band.label} (GSRS ${num(proposal.gsrs)}) for premium capture on high-IV names with strikes beyond the modeled move.`;
  return {
    version: 1,
    headline,
    regime: regimeParagraph(proposal),
    selection: selectionParagraph(proposal),
    picks: picks.map(pick => ({ ticker: pick.ticker, side: pick.side, strike: Number(pick.K), text: pickThesis(pick, proposal) })),
    risk: riskParagraph(proposal),
    execution: executionParagraph(proposal),
    generated_at: new Date().toISOString(),
  };
}

// One-line summary stored on each position (positions.thesis_summary).
export function pickSummary(pick) {
  const otm = Number.isFinite(Number(pick.entry_otm_pct)) ? `${num(pick.entry_otm_pct)}% OTM` : null;
  return [
    `${pick.side === 'call' ? 'Short call' : 'Short put'} at ${pick.K}`,
    otm, Number.isFinite(Number(pick.iv)) ? `${pct(Number(pick.iv) * 100, 0)} IV` : null,
    Number.isFinite(Number(pick.buf)) ? `${num(pick.buf)}× ATR buffer` : null,
    Number.isFinite(Number(pick.delta)) ? `|Δ| ${num(Math.abs(Number(pick.delta)), 2)}` : null,
    pick.family && pick.family !== 'other' ? pick.family.replace(/_/g, ' ') : null,
  ].filter(Boolean).join(', ') + '.';
}
