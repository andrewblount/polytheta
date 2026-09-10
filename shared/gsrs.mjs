// Preserve the existing score formula; expose every input and contribution.
export function calculateGsrs({ VIX, VIX_prev, SKEW, HY_OAS, MOVE, PC }) {
  if (![VIX, VIX_prev, SKEW, HY_OAS, MOVE, PC].every(x => Number.isFinite(x) && x > 0)) throw new Error('GSRS requires all six valid macro inputs');
  const clamp = x => Math.max(0, Math.min(10, x));
  const components = {
    vix: clamp((VIX - 10) / 4 + Math.max(0, VIX - VIX_prev) * 0.5),
    skew: clamp((SKEW - 100) / 10),
    hyoas: clamp((HY_OAS - 1.5) / (3.59 - 1.5) * 5),
    move: clamp((MOVE - 50) / 10),
    pc: clamp((1 - PC) * 7),
  };
  const weights = { vix: 0.4, skew: 0.2, hyoas: 0.2, move: 0.1, pc: 0.1 };
  const contributions = Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value * weights[key]]));
  return { score: +Object.values(contributions).reduce((a,b) => a+b,0).toFixed(2), components, contributions, weights };
}
