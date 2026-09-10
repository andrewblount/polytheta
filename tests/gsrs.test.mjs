import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGsrs } from '../shared/gsrs.mjs';
test('GSRS preserves the original normalized weighted formula', () => {
  const x={VIX:18,VIX_prev:16,SKEW:140,HY_OAS:3.59,MOVE:80,PC:.5};
  const value=calculateGsrs(x);
  assert.deepEqual(value.components,{vix:3,skew:4,hyoas:5,move:3,pc:3.5});
  assert.equal(value.score,3.65);
  assert.equal(calculateGsrs({VIX:1,VIX_prev:1,SKEW:1,HY_OAS:.1,MOVE:1,PC:2}).score,0);
  assert.throws(()=>calculateGsrs({...x,HY_OAS:undefined}),/requires/);
});
