import { buildWindows, diagnoseAll, fitSynthetic } from '/workspace/src/engine/analysis.js';
import { solveSimplexExact, solveSimplexProjected } from '/workspace/src/engine/solver.js';
import fs from 'node:fs';
const DATA = JSON.parse(fs.readFileSync('/workspace/data/stores.json', 'utf8'));
let exactTimes = [];
let approxTimes = [];
for (const study of DATA.studies) {
  const windows = buildWindows(DATA, study);
  for (const id of Object.keys(DATA.stores)) {
    if (id === study.store) continue;
    const all = diagnoseAll(DATA, windows, id);
    const ds = all.filter(d => d.eligible).map(d => d.id);
    if (!ds.length) continue;
    let t0 = performance.now();
    const fit = fitSynthetic(DATA, windows, id, ds, { solver: solveSimplexExact });
    exactTimes.push(performance.now() - t0);
    t0 = performance.now();
    const fit2 = fitSynthetic(DATA, windows, id, ds, { solver: solveSimplexProjected });
    approxTimes.push(performance.now() - t0);
    if (!fit.ok) continue;
    const fitDates = fit.fitDates;
    const y = fitDates.map(d => DATA.stores[id].daily[d].v);
    const mean = y.reduce((a,b)=>a+b,0)/y.length;
    const X = fitDates.map(d => ds.map(s => DATA.stores[s].daily[d].v / mean));
    const Y = y.map(v => v / mean);
    const w = ds.map(s => fit.weights[s]);
    const grad = ds.map((_, j) => 2 * X.reduce((a, row, i) => a + (row.reduce((s, v, k) => s + v * w[k], 0) - Y[i]) * row[j], 0));
    const pos = grad.filter((_, j) => w[j] > 1e-6);
    const zeros = grad.filter((_, j) => w[j] <= 1e-6);
    const spread = pos.length ? Math.max(...pos) - Math.min(...pos) : 0;
    // 零权重处梯度必须不低于正权重处的共同梯度（否则应被激活）。
    const kkt = zeros.length && pos.length ? Math.min(...pos) - Math.min(...zeros) : 0;
    const obj = (ww) => X.reduce((a,row,i)=>a+(row.reduce((s,v,k)=>s+v*ww[k],0)-Y[i])**2,0);
    const w2 = ds.map(s => fit2.weights[s]);
    if (spread > 1e-6 || kkt > 1e-6) console.log('KKT BAD', study.store, id, 'spread', spread.toExponential(2), 'kkt', kkt.toExponential(2), 'ncomp', fitDates.length);
    if (obj(w) > obj(w2) + 1e-12) console.log('EXACT WORSE', study.store, id, obj(w) - obj(w2));
    if (Math.abs(obj(w) - obj(w2)) > 1e-9) console.log('DIFF', study.store, id, (obj(w)-obj(w2)).toExponential(2), 'w', w.map(v=>v.toFixed(3)).join(','), '|', w2.map(v=>v.toFixed(3)).join(','));
  }
}
const med = a => a.sort((x,y)=>x-y)[Math.floor(a.length/2)].toFixed(1);
console.log('exact median', med(exactTimes), 'max', Math.max(...exactTimes).toFixed(1), 'total', exactTimes.reduce((a,b)=>a+b,0).toFixed(0));
console.log('approx median', med(approxTimes), 'max', Math.max(...approxTimes).toFixed(1), 'total', approxTimes.reduce((a,b)=>a+b,0).toFixed(0));
