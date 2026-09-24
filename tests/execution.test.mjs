import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrokerSettings, basketCounts } from '../shared/broker-settings.mjs';
import { entryBudget, planEntry, planExit, validateMargin, exitSignal } from '../shared/execution-policy.mjs';
import { executionCycle } from '../scripts/broker/execution-engine.mjs';
const now = new Date('2026-09-08T14:00:00Z');
const settings = validateBrokerSettings({pauseEntries:false});
const pick={ticker:'ABC',name:'Acme',side:'call',K:25,px:20,atr:2,cr:0.5,iv:1,pricing_reference:{observedAt:now.toISOString(),spot:20,iv:1,vix:20,credit:.5,strike:25,side:'call',expiry:'2026-09-11'},rule_checks:{earnings_clear:'pass',thesis_signals:{radar:'pass'}}};
const proposal={basket_date:'2026-09-07',expiry:'2026-09-11',generated_ts:now.toISOString(),data_observed_at:now.toISOString(),picks:[pick]};
const account={grossPositionValue:0,netLiquidation:10000,availableFunds:10000,excessLiquidity:10000,cash:10000};
const contract={conid:123,symbol:'ABC',side:'call',strike:25,expiry:proposal.expiry,multiplier:100,tick:0.01};
const quote={conid:123,bid:0.45,ask:0.55,bidSize:10,askSize:10,delta:0.18,optionIv:1,underlyingPrice:20,observedAt:+now,realtime:true};
function mock() {
  return {account:'U_TEST',connect:async()=>({mode:'live'}),positions:async()=>[],orders:async()=>[],executions:async()=>[],accountSummary:async()=>account,resolve:async()=>contract,quote:async()=>quote,preview:async()=>({initialMarginChange:500,maintenanceMarginChange:500}),submissions:[],submit:async function(o){this.submissions.push(o);return{orderId:'1',status:'Submitted'}},cancel:async()=>{},modify:async()=>{}};
}
test('allocation split controls counts and max count, with equal dollar shares', () => {
  const s=validateBrokerSettings({maxTrades:6,callAllocationPct:75,putAllocationPct:25});
  assert.deepEqual(basketCounts(s),{calls:3,puts:1,total:4});
  assert.deepEqual(basketCounts(s,2,1),{calls:0,puts:0,total:0});
  assert.throws(()=>validateBrokerSettings({maxTrades:3,callAllocationPct:75,putAllocationPct:25}),/whole/);
  const b=entryBudget(proposal,account,settings,now);
  assert.equal(b.total,10000);assert.equal(b.perTrade,10000);
  // $10,000 per trade at the default 400% margin available backs $40,000 of notional: 16 contracts at $25.
  assert.equal(planEntry(pick,contract,quote,b,settings,now).quantity,16);
  assert.equal(planEntry(pick,contract,quote,b,{...settings,marginAvailablePct:100},now).quantity,4);
  assert.equal(entryBudget(proposal,account,{...settings,entryCapitalPct:20},now).total,2000);
  // Side toggles gate execution; the model basket itself is unchanged.
  assert.throws(()=>planEntry(pick,contract,quote,b,{...settings,sellCalls:false},now),/switched off/);
  assert.equal(planEntry({...pick,side:'put',K:15,pricing_reference:{...pick.pricing_reference,side:'put',strike:15}},{...contract,side:'put',strike:15},{...quote,delta:-0.18},b,{...settings,sellCalls:false},now).quantity,20);
});
test('delayed, stale, crossed and insufficient quotes prevent entries', () => {
  const b=entryBudget(proposal,account,settings,now);
  for (const q of [{...quote,realtime:false},{...quote,observedAt:+now-60000},{...quote,bid:0.7},{...quote,delta:0.35},{...quote,underlyingPrice:26}]) assert.throws(()=>planEntry(pick,contract,q,b,settings,now));
  assert.throws(()=>validateMargin({initialMarginChange:NaN,maintenanceMarginChange:5},account,{budget:100}));
});
test('exits close only owned shorts and only on actionable news', () => {
  assert.equal(planExit({quantity:-10},contract,quote,3,settings,now).quantity,3);
  assert.throws(()=>planExit({quantity:10},contract,quote,3,settings,now));
  assert.equal(exitSignal([{actionable:false,publishedAt:now.toISOString(),link:'https://example.com'}],now),null);
});
test('disabled execution can read account state but never submits', async()=>{
  const broker=mock();await executionCycle({broker,proposal,settings,journal:{},save:async()=>{},scanNews:async()=>[],now});assert.equal(broker.submissions.length,0);
});
test('week-scoped paper activation blocks other baskets but keeps owned exits enabled', async () => {
  const broker = mock(); broker.account = 'DU_TEST'; broker.connect = async () => ({ mode: 'paper' });
  const args = { broker, proposal, settings: { ...settings, accountMode: 'paper' }, journal: {}, save: async () => {}, scanNews: async () => [], enabled: true, now, authorizedEntryWeek: '2026-09-21' };
  const monitoring = await executionCycle(args);
  assert.equal(monitoring.health?.mode, 'paper');
  assert.equal(monitoring.account?.netLiquidation, account.netLiquidation);
  assert.equal(broker.submissions.length, 0);
  await executionCycle({ ...args, authorizedEntryWeek: proposal.basket_date });
  assert.equal(broker.submissions.length, 1);
  const entry = Object.values(args.journal.intents)[0];
  broker.orders = async () => [{ orderId: '1', ref: entry.ref, conid: 123, status: 'Filled', filled: entry.quantity }];
  broker.executions = async () => [{ executionId: 'P1', ref: entry.ref, conid: 123, quantity: entry.quantity, price: .5 }];
  broker.positions = async () => [{ conid: 123, quantity: -entry.quantity }];
  await executionCycle({ ...args, scanNews: async () => [{ actionable: true, link: 'https://reuters.com/test', publishedAt: now.toISOString() }] });
  assert.equal(broker.submissions.at(-1).action, 'exit');
});
test('intent is durable before submit and reruns do not double an entry',async()=>{
  const broker=mock(),journal={};let beforeWrite=false;
  broker.submit=async function(o){assert.equal(journal.intents[o.ref].status,'uncertain');beforeWrite=true;this.submissions.push(o);return{orderId:'1',status:'Submitted'}};
  const args={broker,proposal,settings,journal,save:async()=>{},scanNews:async()=>[],enabled:true,now};
  await executionCycle(args);await executionCycle(args);assert.equal(beforeWrite,true);assert.equal(broker.submissions.length,1);
});
test('timed-out submissions remain uncertain and are never blindly retried',async()=>{
  const broker=mock(),journal={};broker.submit=async()=>{throw new Error('timeout')};
  const args={broker,proposal,settings,journal,save:async()=>{},scanNews:async()=>[],enabled:true,now};
  await assert.rejects(executionCycle(args),/timeout/);
  await assert.rejects(executionCycle(args),/uncertain/);
});
test('news exit waits for entry cancellation, then closes the partial fill only',async()=>{
  const broker=mock(),journal={};const base={broker,proposal,settings,journal,save:async()=>{},scanNews:async()=>[],enabled:true,now};
  await executionCycle(base);const e=Object.values(journal.intents)[0];
  broker.positions=async()=>[{conid:123,quantity:-2}];
  broker.executions=async()=>[{executionId:'E1',ref:e.ref,conid:123,orderId:'1',quantity:2,price:0.50}];
  broker.orders=async()=>[{orderId:'1',ref:e.ref,conid:123,status:'Submitted',filled:2}];
  let cancelled=0;broker.cancel=async()=>{cancelled++};
  const scanNews=async()=>[{actionable:true,link:'https://reuters.com/a',publishedAt:now.toISOString()}];
  await executionCycle({...base,scanNews});assert.equal(cancelled,1);assert.equal(broker.submissions.length,1);
  broker.orders=async()=>[{orderId:'1',ref:e.ref,conid:123,status:'Cancelled',filled:2}];
  await executionCycle({...base,scanNews});assert.equal(broker.submissions[1].action,'exit');assert.equal(broker.submissions[1].quantity,2);
});

test('fresh quotes received after connection latency are not mistaken for future quotes', async () => {
  const broker = mock(), started = Date.now();
  broker.connect = async () => { await new Promise(r => setTimeout(r, 1100)); return { mode: 'live' }; };
  broker.quote = async () => ({ ...quote, observedAt: +now + Date.now() - started });
  await executionCycle({ broker, proposal, settings, journal: {}, save: async()=>{}, scanNews:async()=>[], enabled:true, now });
  assert.equal(broker.submissions.length, 1);
});
test('Exit all includes PolyTheta fills received after the confirmation snapshot', async () => {
  const { accountFingerprint } = await import('../shared/broker-portfolio.mjs');
  const broker = mock(), second = { ...contract, conid: 456, symbol: 'DEF' };
  const journal = { intents: {
    a: { ref:'a', action:'entry', contract, week:proposal.basket_date, pick, quantity:2, status:'Filled', filled:2 },
    b: { ref:'b', action:'entry', contract:second, week:proposal.basket_date, pick:{...pick,ticker:'DEF'}, quantity:1, status:'Filled', filled:1 },
  }, fills: {
    a: { ref:'a', contract, action:'entry', quantity:2, price:.5, commission:1 },
    b: { ref:'b', contract:second, action:'entry', quantity:1, price:.5, commission:1 },
  } };
  broker.positions=async()=>[{conid:123,quantity:-2},{conid:456,quantity:-1},{conid:789,quantity:-10}];
  broker.quote=async c=>({...quote,conid:c.conid});
  const command={requestId:'all',accountKey:accountFingerprint(broker.account),scope:'all',targets:[{conid:123,quantity:2}]};
  await executionCycle({broker,proposal:null,settings,journal,save:async()=>{},scanNews:async()=>[],enabled:true,commands:[command],now});
  assert.deepEqual(broker.submissions.map(o=>o.contract.conid),[123,456]);
  assert.deepEqual(journal.commands.all.targets.map(t=>t.conid),[123,456]);
});
test('an external working order prevents a competing close of the same option', async () => {
  const broker=mock(),journal={intents:{entry:{ref:'entry',action:'entry',contract,week:proposal.basket_date,pick,quantity:2,status:'Filled',filled:2}},fills:{a:{ref:'entry',contract,action:'entry',quantity:2,price:.5}},signals:{123:{manual:true}}};
  broker.positions=async()=>[{conid:123,quantity:-2}];
  broker.orders=async()=>[{conid:123,ref:'manual-ib-order',orderId:'88',status:'Submitted'}];
  await assert.rejects(executionCycle({broker,proposal:null,settings,journal,save:async()=>{},scanNews:async()=>[],enabled:true,now}),/Another IB order/);
  assert.equal(broker.submissions.length,0);
});
test('margin reserve ceiling blocks entries without forcing an exit', () => {
  assert.throws(()=>entryBudget(proposal,{...account,grossPositionValue:50000},settings,now),/reserve ceiling/);
  assert.equal(planExit({quantity:-1},contract,quote,1,settings,now).quantity,1);
});
test('an incomplete account refresh blocks submission after the initial snapshot passed', async () => {
  for (const field of ['grossPositionValue', 'netLiquidation', 'availableFunds', 'excessLiquidity', 'cash']) {
    const broker = mock(); let reads = 0;
    broker.accountSummary = async () => ++reads === 1 ? account : { ...account, [field]: undefined };
    await assert.rejects(executionCycle({ broker, proposal, settings, journal: {}, save: async()=>{}, scanNews: async()=>[], enabled: true, now }), /unavailable|insufficient/);
    assert.equal(broker.submissions.length, 0, field);
  }
});
test('a changed basket cannot reuse committed allocation slots', async () => {
  const broker = mock(), journal = {};
  const args = { broker, proposal, settings, journal, save: async()=>{}, scanNews: async()=>[], enabled: true, now };
  await executionCycle(args);
  const intent = Object.values(journal.intents)[0];
  broker.orders = async () => [{ ref: intent.ref, conid: contract.conid, orderId: '1', status: 'Cancelled', filled: 0 }];
  await assert.rejects(executionCycle({ ...args, proposal: { ...proposal, picks: [{ ...pick, K: 26 }] } }), /Allocation changed/);
  assert.equal(broker.submissions.length, 1);
});
