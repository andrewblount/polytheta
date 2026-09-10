export function normalizePriceIncrements(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('IB contract price increments are unavailable');
  const result = rows.map(r => ({ lowEdge: Number(r.lowEdge ?? r.lowerEdge), increment: Number(r.increment) }))
    .sort((a, b) => a.lowEdge - b.lowEdge);
  if (result[0].lowEdge !== 0 || result.some((r, i) => !Number.isFinite(r.lowEdge) || r.lowEdge < 0 || !Number.isFinite(r.increment) || r.increment <= 0 || i && r.lowEdge === result[i - 1].lowEdge)) throw new Error('IB returned invalid contract price increments');
  return result;
}

function rulesFor(contract) {
  return normalizePriceIncrements(typeof contract === 'number'
    ? [{ lowEdge: 0, increment: contract }]
    : contract.priceIncrements ?? [{ lowEdge: 0, increment: contract.tick }]);
}

export function tickForPrice(price, contract) {
  if (!Number.isFinite(price) || price < 0) throw new Error('Invalid option price');
  return rulesFor(contract).findLast(r => r.lowEdge <= price).increment;
}

// The next rule starts at its low edge. Ceil rounding that crosses a rule
// boundary must use that boundary, not an increment from the cheaper band.
export function roundPrice(price, contract, direction = 'floor') {
  if (!Number.isFinite(price) || price < 0 || !['floor', 'ceil'].includes(direction)) throw new Error('Invalid price rounding request');
  const rules = rulesFor(contract);
  const index = rules.findLastIndex(r => r.lowEdge <= price);
  const rule = rules[index];
  const units = (price - rule.lowEdge) / rule.increment;
  let value = rule.lowEdge + Math[direction](units + (direction === 'floor' ? 1e-9 : -1e-9)) * rule.increment;
  if (direction === 'ceil' && rules[index + 1] && value >= rules[index + 1].lowEdge) value = rules[index + 1].lowEdge;
  return +value.toFixed(10);
}
