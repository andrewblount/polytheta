// Chunked chain + IV fetch. Usage: node _chains_chunk_2026_06_22.mjs <start> <end>
// Appends rows to chains and summary CSVs, tracks processed tickers in a state file.
import YahooFinance from 'yahoo-finance2';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const BASKET_DATE = '2026-06-29';
const EXPIRY_ISO = '2026-07-02';
const OUT = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');

const START = parseInt(process.argv[2] ?? '0', 10);
const END   = parseInt(process.argv[3] ?? '30', 10);

const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'] });

function csvRow(vals) { return vals.map(v => v == null ? '' : (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v))).join(','); }
function ncdf(x){const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;const sign=x<0?-1:1;x=Math.abs(x)/Math.SQRT2;const t=1/(1+p*x);const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);return 0.5*(1+sign*y);}
function bsDelta(S,K,T,r,sigma,type){if(T<=0||sigma<=0)return type==='call'?(S>K?1:0):(S<K?-1:0);const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));return type==='call'?ncdf(d1):ncdf(d1)-1;}
function realizedVol(closes,w){if(closes.length<w+1)return null;const rets=[];for(let i=closes.length-w;i<closes.length;i++)if(closes[i-1]>0)rets.push(Math.log(closes[i]/closes[i-1]));const m=rets.reduce((a,b)=>a+b,0)/rets.length;const v=rets.reduce((a,b)=>a+(b-m)**2,0)/(rets.length-1);return Math.sqrt(v*252);}
function rollingRV(closes,w){const out=[];for(let i=w;i<closes.length;i++){const sub=closes.slice(i-w,i+1);out.push(realizedVol(sub,w));}return out.filter(v=>v!=null);}
function hvRank(s,c){if(!s.length||c==null)return null;const mx=Math.max(...s),mn=Math.min(...s);if(mx===mn)return null;return((c-mn)/(mx-mn))*100;}
function atr14(h){if(h.length<15)return null;let t=0,n=0;for(let i=h.length-14;i<h.length;i++){const hi=h[i].high,lo=h[i].low,pc=h[i-1].close;if(hi==null||lo==null||pc==null)continue;t+=Math.max(hi-lo,Math.abs(hi-pc),Math.abs(lo-pc));n++;}return n?t/n:null;}

const ffile = path.join(OUT, 'universe_8to40.csv');
const filtered = fs.readFileSync(ffile,'utf8').trim().split(/\r?\n/);
const header = filtered[0].split(',');
const tickerIdx = header.indexOf('ticker');
const priceIdx = header.indexOf('price');
const tickers = filtered.slice(1).map(l=>{const c=l.split(',');return{ticker:c[tickerIdx],price:parseFloat(c[priceIdx])};}).filter(t=>t.ticker&&Number.isFinite(t.price));

const chainPath = path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`);
const sumPath = path.join(OUT, 'chain_summary_v2.csv');
const errPath = path.join(OUT, 'chain_errors_v2.json');
const statePath = path.join(OUT, '_chains_state.json');

const CHAIN_HEADER = 'ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct\n';
const SUM_HEADER = 'ticker,price,atm_iv,atm_iv_pct,hv20_now,hv20_min,hv20_max,hv_rank,atr14,call_otm_vol_total,put_otm_vol_total,best_call_strike_d18,best_call_credit,best_call_iv,best_put_strike_d18,best_put_credit,best_put_iv\n';

if (!fs.existsSync(chainPath)) fs.writeFileSync(chainPath, CHAIN_HEADER);
if (!fs.existsSync(sumPath)) fs.writeFileSync(sumPath, SUM_HEADER);
let errors = fs.existsSync(errPath) ? JSON.parse(fs.readFileSync(errPath,'utf8')) : [];
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath,'utf8')) : { processed: [] };
const processed = new Set(state.processed);

const now = new Date('2026-06-28T12:00:00Z');
const histStart = new Date(now.getTime()-365*86400*1000);
const expiryDate = new Date(EXPIRY_ISO+'T00:00:00Z');
const T = Math.max((expiryDate.getTime()-now.getTime())/(365*86400*1000), 1/365);
const r = 0.043;

const slice = tickers.slice(START, END);
console.log(`[chunk] ${START}..${END} (${slice.length}) processed_total=${processed.size}`);

let done = 0;
for (const {ticker, price} of slice) {
  if (processed.has(ticker)) { continue; }
  try {
    const hist = await yf.chart(ticker,{period1:histStart,period2:now,interval:'1d'});
    const closes = hist.quotes.map(q=>q.close).filter(c=>c!=null&&c>0);
    const ohlc = hist.quotes.filter(q=>q.high!=null&&q.low!=null&&q.close!=null).map(q=>({high:q.high,low:q.low,close:q.close}));
    const hv20Series = rollingRV(closes,20);
    const hv20Now = realizedVol(closes,20);
    const rank = hvRank(hv20Series, hv20Now);
    const atr = atr14(ohlc);

    let chain;
    try { chain = await yf.options(ticker,{date:expiryDate}); } catch { chain=null; }
    if (!chain) {
      const all = await yf.options(ticker);
      const exps = (all?.expirationDates??[]).map(d=>new Date(d));
      const tgt = exps.find(d=>Math.abs(d.getTime()-expiryDate.getTime())<86400000*2);
      if (tgt) chain = await yf.options(ticker,{date:tgt});
    }
    if (!chain||!chain.options||!chain.options.length) throw new Error('no chain');

    const calls = chain.options[0].calls??[];
    const puts = chain.options[0].puts??[];
    let atmIvSum=0,atmIvN=0,bestCall=null,bestPut=null,callOtmVolSum=0,putOtmVolSum=0;
    const localChainRows=[];

    for (const c of calls) {
      const iv=c.impliedVolatility;
      const delta=iv?bsDelta(price,c.strike,T,r,iv,'call'):null;
      const dist=((c.strike-price)/price)*100;
      const mid=(c.bid!=null&&c.ask!=null)?(c.bid+c.ask)/2:(c.lastPrice??null);
      localChainRows.push(csvRow([ticker,c.strike,'call',c.bid,c.ask,c.lastPrice,iv,c.volume,c.openInterest,delta?.toFixed(3),dist.toFixed(2)]));
      if(Math.abs(c.strike-price)/price<0.03&&iv){atmIvSum+=iv;atmIvN++;}
      if(c.strike>price) callOtmVolSum+=c.volume??0;
      if(delta!=null&&delta>=0.13&&delta<=0.22&&mid!=null&&mid>0.01&&c.bid!=null&&c.bid>0){
        if(!bestCall||Math.abs(delta-0.18)<Math.abs(bestCall.delta-0.18)) bestCall={strike:c.strike,mid,iv,delta};
      }
    }
    for (const p of puts) {
      const iv=p.impliedVolatility;
      const delta=iv?bsDelta(price,p.strike,T,r,iv,'put'):null;
      const dist=((p.strike-price)/price)*100;
      const mid=(p.bid!=null&&p.ask!=null)?(p.bid+p.ask)/2:(p.lastPrice??null);
      localChainRows.push(csvRow([ticker,p.strike,'put',p.bid,p.ask,p.lastPrice,iv,p.volume,p.openInterest,delta?.toFixed(3),dist.toFixed(2)]));
      if(Math.abs(p.strike-price)/price<0.03&&iv){atmIvSum+=iv;atmIvN++;}
      if(p.strike<price) putOtmVolSum+=p.volume??0;
      if(delta!=null&&delta<=-0.13&&delta>=-0.22&&mid!=null&&mid>0.01&&p.bid!=null&&p.bid>0){
        if(!bestPut||Math.abs(Math.abs(delta)-0.18)<Math.abs(Math.abs(bestPut.delta)-0.18)) bestPut={strike:p.strike,mid,iv,delta};
      }
    }
    const atmIv = atmIvN?atmIvSum/atmIvN:null;
    const sumRow = csvRow([ticker,price,atmIv?.toFixed(4),atmIv?(atmIv*100).toFixed(1):null,hv20Now?.toFixed(4),hv20Series.length?Math.min(...hv20Series).toFixed(4):null,hv20Series.length?Math.max(...hv20Series).toFixed(4):null,rank?.toFixed(1),atr?.toFixed(3),callOtmVolSum,putOtmVolSum,bestCall?.strike,bestCall?.mid?.toFixed(3),bestCall?.iv?.toFixed(4),bestPut?.strike,bestPut?.mid?.toFixed(3),bestPut?.iv?.toFixed(4)]);

    fs.appendFileSync(chainPath, localChainRows.join('\n')+'\n');
    fs.appendFileSync(sumPath, sumRow+'\n');
    processed.add(ticker);
    done++;
  } catch (e) {
    errors.push({ticker,err:e.message});
  }
  await new Promise(r=>setTimeout(r,100));
}

state.processed = [...processed];
fs.writeFileSync(statePath, JSON.stringify(state));
fs.writeFileSync(errPath, JSON.stringify(errors,null,2));
console.log(`[chunk] done ${done} new, total_processed=${processed.size}, errors=${errors.length}`);
