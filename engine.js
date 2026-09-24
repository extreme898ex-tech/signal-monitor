/* pfc3 engine — ported from the reference workbooks' formulas & VBA (WriteChart).
   Excel chain (rows 2..201 = closes[0..n-1]):
     C13 = AVERAGE(B2:B13); Cn = (Bn*2 + Cn-1*11)/13        (EMA12)
     D27 = AVERAGE(B2:B27); Dn = (Bn*2 + Dn-1*25)/27        (EMA26)
     E27 = C27-D27; En = Cn-Dn                              (MACD)
     F35 = AVERAGE(E27:E35); Fn = (En*2 + Fn-1*8)/10        (Signal = MACD 9-day EMA)
     Gn = En-Fn                                             (JUDGE)
   P&F (WriteChart): rowOf(p) = INT(max/box)+3 - INT(p/box); 3-box reversal (tnkn),
     buy  = x-column breaks above previous x-column top  (td1w < k1Pw)  -> mark at (k1Pw-1, col)
     sell = o-column breaks below previous o-column bottom (td1w > u1Pw) -> mark at (u1Pw+1, col)
     水平計算 target = brokenLevel ± box*3*colsSinceLastSignal
     垂直計算 target = currentExtreme ± (se2 - se3)  [last swing height]       */
(function (root) {
  'use strict';

  function avg(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

  // ---- 売買ジャッジ (MACD JUDGE) ---------------------------------------
  function emaJudge(closes) {
    var n = closes.length;
    var C = [], D = [], E = [], F = [], G = [], i;
    for (i = 0; i < n; i++) { C.push(null); D.push(null); E.push(null); F.push(null); G.push(null); }
    if (n < 13) return { C: C, D: D, E: E, F: F, G: G };
    C[11] = avg(closes.slice(0, 12));
    for (i = 12; i < n; i++) C[i] = (closes[i] * 2 + C[i - 1] * 11) / 13;
    if (n >= 26) {
      D[25] = avg(closes.slice(0, 26));
      for (i = 26; i < n; i++) D[i] = (closes[i] * 2 + D[i - 1] * 25) / 27;
      for (i = 25; i < n; i++) E[i] = C[i] - D[i];
      if (n >= 34) {
        F[33] = avg(E.slice(25, 34));
        for (i = 34; i < n; i++) F[i] = (E[i] * 2 + F[i - 1] * 8) / 10;
      }
    }
    for (i = 0; i < n; i++) if (E[i] !== null && F[i] !== null) G[i] = E[i] - F[i];
    return { C: C, D: D, E: E, F: F, G: G };
  }

  // JUDGE sign events: 1 = 買い転換(+), -1 = 売り転換(-), plus continuation state
  function judgeSignals(closes, dates) {
    var r = emaJudge(closes), G = r.G, out = [], state = 0;
    for (var i = 1; i < G.length; i++) {
      if (G[i] === null || G[i - 1] === null) continue;
      var s = G[i] >= 0 ? 1 : -1, p = G[i - 1] >= 0 ? 1 : -1;
      if (state === 0) state = s;
      if (s !== p) {
        state = s;
        out.push({ i: i, date: dates[i], type: s > 0 ? 'buy' : 'sell', judge: G[i], price: closes[i], src: 'judge' });
      }
    }
    return { rows: r, signals: out, state: state, lastJudge: G.length ? G[G.length - 1] : null };
  }

  // ---- 秘伝チャート (3枠転換 P&F, WriteChart port) -----------------------
  function pfChart(closes, dates, box, tnkn) {
    box = +box; tnkn = tnkn || 3;
    var n = closes.length, i;
    if (!(box > 0) || n < 2) return null;
    var maxP = Math.max.apply(null, closes), minP = Math.min.apply(null, closes);
    var topBoxes = Math.floor(maxP / box);              // N15/box
    var rowOf = function (p) { return topBoxes + 3 - Math.floor(p / box); };
    var priceOfRow = function (r) { return box * (topBoxes + 3 - r); };
    var ho1 = 0, re1 = 2, ts1 = null, ts1w = null, ts1d = null;
    var k1P = null, k1Pw = null, k1Pd = null, u1P = null, u1Pw = null, u1Pd = null;
    var se1 = null, se2 = null, se3 = null, re2 = 2;
    var lastTrough = null, lastPeak = null;   // 損切り用: 直近スイングの安値/高値
    var cells = [], cols = 1, events = [];
    function put(r, c, m) { cells.push({ r: r, c: c, m: m }); if (c > cols) cols = c; }
    function draw(from, to, step, mark, col) {
      for (var r = from; step > 0 ? r <= to : r >= to; r += step) put(r, col, mark);
    }
    function buySignal(idx, col) {
      var re2c = re1 - re2 + 1, c = box * 3 * re2c, se4;
      var ev = { i: idx, date: dates[idx], type: 'buy', price: closes[idx], level: k1P, col: col, src: 'pf' };
      ev.h1 = k1P + c;                                  // 水平計算
      if (se2 !== null && se3 !== null) { se4 = se2 - se3; ev.h2 = se1 + se4; } // 垂直計算
      if (lastTrough !== null) ev.stop = lastTrough;    // 損切り: 直近の押し安値
      events.push(ev);
      put(k1Pw - 1, col, 'buy');                        // ★
      k1P = null; k1Pw = null; re2 = re1;
    }
    function sellSignal(idx, col) {
      var re2c = re1 - re2 + 1, c = box * 3 * re2c, se4;
      var ev = { i: idx, date: dates[idx], type: 'sell', price: closes[idx], level: u1P, col: col, src: 'pf' };
      ev.h1 = u1P - c;
      if (se2 !== null && se3 !== null) { se4 = se3 - se2; ev.h2 = se1 - se4; }
      if (lastPeak !== null) ev.stop = lastPeak;        // 損切り: 直近の戻り高値
      events.push(ev);
      put(u1Pw + 1, col, 'sell');                       // ●
      u1P = null; u1Pw = null; re2 = re1;
    }
    for (i = 0; i < n; i++) {
      var td1 = closes[i], td1w = rowOf(td1);
      if (ho1 === 0) {
        if (ts1w !== null && ts1w + tnkn <= td1w) {
          ho1 = -1; draw(ts1w, td1w, 1, 'o', re1);
          ts1d = ts1d === null ? dates[i] : ts1d; ts1 = td1; ts1w = td1w;
          continue;
        } else if (ts1w !== null && ts1w - tnkn >= td1w) {
          ho1 = 1; draw(ts1w, td1w, -1, 'x', re1);
          ts1 = td1; ts1w = td1w; continue;
        } else if (ts1w === null) { ts1 = td1; ts1w = td1w; ts1d = dates[i]; continue; }
          else continue;
      }
      if (ho1 === 1 && ts1w + tnkn <= td1w) {           // 下落転換
        lastPeak = ts1;
        k1Pw = ts1w; k1P = ts1; k1Pd = ts1d;
        se3 = se2; se2 = se1; se1 = ts1;
        ho1 = -1; re1++;
        draw(ts1w + 1, td1w, 1, 'o', re1);
        if (u1P !== null && td1w > u1Pw) sellSignal(i, re1);
      } else if (ho1 === 1 && ts1 <= td1) {             // ×更新
        draw(ts1w, td1w, -1, 'x', re1);
        if (k1Pw !== null && td1w < k1Pw) buySignal(i, re1);
      } else if (ho1 === 1) { /* 天底更新なし */ }
      else if (ho1 === -1 && ts1w - tnkn >= td1w) {     // 上昇転換
        lastTrough = ts1;
        u1Pw = ts1w; u1P = ts1; u1Pd = ts1d;
        se3 = se2; se2 = se1; se1 = ts1;
        ho1 = 1; re1++;
        draw(ts1w - 1, td1w, -1, 'x', re1);
        if (k1Pw !== null && td1w < k1Pw) buySignal(i, re1);
      } else if (ho1 === -1 && ts1 >= td1) {            // ○更新
        draw(ts1w, td1w, 1, 'o', re1);
        if (u1Pw !== null && td1w > u1Pw) sellSignal(i, re1);
      }
      ts1d = dates[i]; ts1 = td1; ts1w = td1w;
    }
    return {
      box: box, tnkn: tnkn, cells: cells, cols: cols, dir: ho1,
      last: ts1, lastDate: ts1d, events: events, rowOf: rowOf, priceOfRow: priceOfRow,
      topBoxes: topBoxes, minRow: rowOf(minP), maxRow: rowOf(maxP)
    };
  }

  var api = { emaJudge: emaJudge, judgeSignals: judgeSignals, pfChart: pfChart, avg: avg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PfcEngine = api;
})(this);
