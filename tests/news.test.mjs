import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNews } from '../shared/news-radar.mjs';
import { evaluateSignals } from '../scripts/lib/thesis_signals.mjs';
const now = new Date('2026-09-08T15:00:00Z');
const article = title => ({title,link:'https://www.reuters.com/example',publisher:'Reuters',providerPublishTime:+now/1000-60,relatedTickers:['ABC']});
const scan = items => classifyNews(items,{ticker:'ABC',name:'Acme Corporation',now});
test('unrelated syndicated headlines cannot trigger an exit', () => {
  assert.equal(scan([article('Paramount merger hits a setback')]).call.length,0);
  assert.equal(scan([article('Acme boosts customer acquisition')]).call[0]?.actionable ?? false,false);
  assert.equal(scan([article('Acme completes acquisition of another company')]).call.length,0);
});
test('credible target-specific takeover and downside events qualify', () => {
  assert.equal(scan([article('Acme takeover talks confirmed by sources')]).call[0].actionable,true);
  assert.equal(scan([article('Buyer to acquire Acme for cash')]).call[0].actionable,true);
  assert.equal(scan([article('Acme cuts guidance after data breach')]).put[0].actionable,true);
});
test('unknown time, future time, expired news and untrusted publishers are not automatic exits', () => {
  assert.equal(scan([{...article('Acme takeover talks'),providerPublishTime:null}]).call.length,0);
  assert.equal(scan([{...article('Acme takeover talks'),providerPublishTime:+now+3600000}]).call.length,0);
  assert.equal(scan([{...article('Acme takeover talks'),providerPublishTime:+now-100*3600000}]).call.length,0);
  assert.equal(scan([{...article('Acme takeover talks'),publisher:'Blog',link:'https://example.com/story'}]).call[0].actionable,false);
});
test('manual clean cannot override fresh radar; outages block entry', () => {
  const args={ticker:'ABC',side:'call',siCache:{},overrides:{ABC:{acq_radar:'clean'}}};
  assert.equal(evaluateSignals({...args,autoRadar:'triggered'}).disqualified,true);
  assert.equal(evaluateSignals({...args,autoRadar:null}).disqualified,true);
});

test('credible company-party merger agreements qualify without matching the buyer', () => {
  const now = new Date('2026-09-08T14:00:00Z');
  const items = ['Acme signs merger agreement with Buyer', 'Acme merger with Beta approved by board'].map(title => ({ title, link: 'https://reuters.com/deal', publisher: 'Reuters', providerPublishTime: now }));
  const found = classifyNews(items, { ticker: 'ACME', name: 'Acme', now });
  assert.equal(found.call.length, 2); assert.equal(found.call.every(h => h.actionable), true);
});
