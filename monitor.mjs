/* 常時監視スクリプト（monitor.mjs）— サーバー側でデータ取得→シグナル計算→通知
 * 必要な環境変数（GitHubのSecretsに設定）:
 *   WEB3FORMS_ACCESS_KEY  メール通知用（任意。未設定ならメール送信なし）
 *   NOTIFY_EMAIL_TO       送信先メールアドレス（任意・未設定ならキー主の宛先）
 *   LINE_TOKEN / LINE_USER_ID  LINE通知用（任意。未設定ならLINE送信なし）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ALL } from './symbols.mjs';
const require = createRequire(import.meta.url);
const E = require('./engine.js');

const F = process.env.WEB3FORMS_ACCESS_KEY, TO = process.env.NOTIFY_EMAIL_TO;
const LT = process.env.LINE_TOKEN, LU = process.env.LINE_USER_ID;
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowJST = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

async function getText(url){
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.text();
  } finally { clearTimeout(tm); }
}
const VIA = [u => u, u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)];
async function getTextAny(url){   /* 直 → 中継の順。サーバー側でも429・ボット対策に備える */
  let err;
  for (const f of VIA){ try { const t = await getText(f(url)); if (t) return t; } catch(e){ err = e; } }
  throw err || new Error('fetch failed');
}
const STOOQ_MAP = { '^N225':'^nkx', '^DJI':'^dji', '^GSPC':'^spx', '^IXIC':'^ndq', 'CL=F':'cl.f', 'BZ=F':'cb.f', 'GC=F':'gc.f' };
function stooqSym(sym){
  if (STOOQ_MAP[sym]) return STOOQ_MAP[sym];
  if (/^\d{4,5}\.T$/.test(sym)) return sym.slice(0, -2) + '.jp';
  if (/^[A-Z]{6}=X$/.test(sym)) return sym.slice(0, -2).toLowerCase();
  if (/^[A-Z]{1,6}$/.test(sym)) return sym.toLowerCase() + '.us';
  if (/^[A-Z]{2,5}-USD$/.test(sym)) return sym.slice(0, -4).toLowerCase() + 'usd';
  return null;
}
const CG_MAP = { 'BTC-JPY':['bitcoin','jpy'], 'ETH-JPY':['ethereum','jpy'], 'XRP-JPY':['xrp','jpy'], 'SOL-JPY':['solana','jpy'], 'DOGE-JPY':['dogecoin','jpy'], 'BTC-USD':['bitcoin','usd'] };
function parseCSV(text){
  const p2 = v => String(v).padStart(2, '0'), rows = [];
  let closeIdx = -1;
  for (let line of text.split(/\r?\n/)){
    line = line.trim(); if (!line) continue;
    const delim = line.includes('\t') ? '\t' : (line.includes(';') && !line.includes(',') ? ';' : ',');
    const cols = line.split(delim).map(s => s.trim().replace(/^"|"$/g, ''));
    if (!/^\d{4}[-/.]/.test(cols[0])){
      let ci = cols.findIndex(c => /^(終値|close)$/i.test(c));
      if (ci < 0) ci = cols.findIndex(c => /終値|close/i.test(c));
      if (ci >= 0) closeIdx = ci;
      continue;
    }
    const num = v => parseFloat(String(v).replace(/,/g, ''));
    let close = null;
    if (closeIdx >= 0 && cols[closeIdx]) close = num(cols[closeIdx]);
    else if (cols.length >= 5) close = num(cols[4]);
    else if (cols.length === 2) close = num(cols[1]);
    const dt = cols[0].replace(/\//g, '-');
    if (!isFinite(close)) continue;
    rows.push([dt, close]);
  }
  rows.sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (rows.length < 40) throw new Error('data too short');
  return { dates: rows.map(r => r[0]), closes: rows.map(r => r[1]) };
}
async function fetchOne(sym){   /* Yahoo → Stooq → CoinGecko の順（サーバーからは中継不要） */
  try {
    const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=10mo&interval=1d';
    const j = JSON.parse(await getTextAny(u));
    const res = j.chart.result[0], ts = res.timestamp || [], q = res.indicators.quote[0].close || [];
    const dates = [], closes = [];
    for (let i = 0; i < ts.length; i++){ if (q[i] != null && isFinite(q[i])){ dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10)); closes.push(q[i]); } }
    if (closes.length >= 40) return { dates, closes, via: 'yahoo' };
    throw new Error('short');
  } catch(e1){
    const ss = stooqSym(sym);
    if (ss){
      try { const r = parseCSV(await getTextAny('https://stooq.com/q/d/l/?s=' + encodeURIComponent(ss) + '&i=d'));
        return { ...r, via: 'stooq' }; } catch(e2){}
    }
    const cc = CG_MAP[sym];
    if (cc){
      const j = JSON.parse(await getText('https://api.coingecko.com/api/v3/coins/' + cc[0] + '/market_chart?vs_currency=' + cc[1] + '&days=365&interval=daily'));
      return { dates: j.prices.map(x => new Date(x[0]).toISOString().slice(0, 10)), closes: j.prices.map(x => x[1]), via: 'coingecko' };
    }
    throw new Error('all sources failed');
  }
}
async function notify(text){
  const sent = [];
  if (F){ try { const r = await fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_key: F, subject: '【売買シグナル】新規シグナル検出', message: text, from_name: '売買シグナル監視', ...(TO ? { email: TO } : {}) }) });
    const j = await r.json(); sent.push('email:' + (j.success ? 'ok' : 'ng')); } catch(e){ sent.push('email:err'); } }
  if (LT && LU){ try { const r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LT },
      body: JSON.stringify({ to: LU, messages: [{ type: 'text', text: text.slice(0, 4900) }] }) });
    sent.push('line:' + r.status); } catch(e){ sent.push('line:err'); } }
  return sent;
}
(async () => {
  const state = existsSync('state.json') ? JSON.parse(readFileSync('state.json', 'utf8')) : {};
  const out = [], news = [];
  async function one(it){
    try {
      const d = await fetchOne(it.s);
      const box = it.boxes.find(b => b > 0) || 20;
      const pf = E.pfChart(d.closes, d.dates, box, 3) || {};
      const js = E.judgeSignals(d.closes, d.dates);
      const last = (pf.events && pf.events.length) ? pf.events[pf.events.length - 1] : null;
      const sig = last ? { type: last.type, date: last.date, price: Math.round(d.closes[d.closes.length - 1] * 1000) / 1000 } : null;
      const key = it.s, prev = state[key];
      const isNew = sig && (!prev || prev.date !== sig.date || prev.type !== sig.type);
      if (isNew) { news.push({ ...it, sig }); state[key] = sig; }
      out.push({ name: it.n, sym: it.s, cat: it.cat, via: d.via, last: d.dates[d.dates.length - 1],
        close: d.closes[d.closes.length - 1], signal: sig, judge: js.state });
    } catch(e){ out.push({ name: it.n, sym: it.s, cat: it.cat, error: String(e.message || e) }); }
  }
  const CH = 5;
  for (let i = 0; i < ALL.length; i += CH){ await Promise.all(ALL.slice(i, i + CH).map(one)); await sleep(300); }
  const failed = ALL.filter(it => out.find(o => o.sym === it.s && o.error));
  for (let i = 0; i < failed.length; i += CH){   /* 失敗銘柄だけ最後にもう1回（経路は中継側） */
    await Promise.all(failed.slice(i, i + CH).map(it => one(it)));
    failed.slice(i, i + CH).forEach(it => { const o = out.find(x => x.sym === it.s); if (o && o.error) out.splice(out.indexOf(o), 1); });
    await sleep(300);
  }
  const prevOut = existsSync('signals.json') ? JSON.parse(readFileSync('signals.json', 'utf8')) : null;
  writeFileSync('signals.json', JSON.stringify({ generated_at: nowJST(), results: out }, null, 1));
  writeFileSync('state.json', JSON.stringify(state, null, 1));
  const okN = out.filter(r => !r.error).length, errN = out.length - okN;
  let log = 'シグナル監視 ' + nowJST() + ' ／ 取得成功 ' + okN + '/' + out.length + '銘柄' + (errN ? '（失敗: ' + out.filter(r => r.error).map(r => r.sym).join(' ') + '）' : '');
  if (news.length){
    log += '\n\n■ 新規シグナル ' + news.length + '件\n' + news.map(n =>
      '・' + n.n + '（' + n.s + '）' + (n.sig.type === 'buy' ? '★買い' : '●売り') + ' シグナル日 ' + n.sig.date + ' 終値 ' + n.sig.price).join('\n');
    const sent = await notify(log);
    console.log('NOTIFY ' + sent.join(' '));
  } else console.log('new signals: none');
  console.log(log);
})();
