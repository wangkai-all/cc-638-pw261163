import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  analyzeStudy, buildWindows, diagnoseAll, fitSynthetic, getStudy, placeboScan,
  buildWindows as bw, dayDetail, statusAt, valueAt,
} from '../src/engine/analysis.js';
import { solveSimplexExact, solveSimplexProjected } from '../src/engine/solver.js';

const DATA = JSON.parse(fs.readFileSync(new URL('../data/stores.json', import.meta.url), 'utf8'));
const STUDY = DATA.studies[0];

function near(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${a}≈${b} (±${tol})`);
}

test('权重非负且和为一', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  assert.ok(a.current.ok);
  const ws = Object.values(a.current.weights);
  for (const w of ws) assert.ok(w >= 0, 'weight must be non-negative');
  near(ws.reduce((x, y) => x + y, 0), 1, 1e-9, 'weights sum');
});

test('活动期与活动后的数据不参与权重', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const w = a.windows;
  const preOnly = new Set(w.preDates);
  for (const d of a.current.fitDates) assert.ok(preOnly.has(d), `fit date ${d} must be pre-event`);
  for (const d of a.current.fitDates) {
    assert.ok(statusAt(DATA, a.subjectId, d) === 'observed', 'subject observed');
    for (const [id, weight] of Object.entries(a.current.weights)) {
      if (weight > 0) assert.ok(valueAt(DATA, id, d) != null, `donor ${id} observed on fit day ${d}`);
    }
  }
  // 改变活动期数据不应改变权重。
  const clone = structuredClone(DATA);
  for (const d of [...w.eventDates, ...w.postDates]) {
    for (const st of Object.values(clone.stores)) {
      if (st.daily[d]?.status === 'observed') st.daily[d].v = Math.round(st.daily[d].v * 1.7);
    }
  }
  const b = analyzeStudy(clone, { studyId: STUDY.store });
  for (const [id, weight] of Object.entries(a.current.weights)) {
    near(b.current.weights[id], weight, 1e-9, `weight of ${id} unchanged by post-event data`);
  }
});

test('拟合日必须是双方都有观测的日期', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const w = a.windows;
  const set = new Set(a.current.fitDates);
  for (const d of w.preDates) {
    const subjOk = valueAt(DATA, a.subjectId, d) != null;
    const donorsOk = Object.entries(a.current.weights)
      .filter(([, wt]) => wt > 0)
      .every(([id]) => valueAt(DATA, id, d) != null);
    assert.equal(set.has(d), subjOk && donorsOk, `fitness of date ${d}`);
  }
});

test('停业与漏报分开记录，并给出不同原因', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const s02 = a.diagnoses.find((d) => d.id === 'S02');
  assert.ok(s02.closureDays > 0, 'S02 has closure days');
  assert.ok(s02.missingDays > 0, 'S02 has missing days');
  assert.ok(s02.reasons.some((r) => r.includes('连续漏报')), 'mentions missing run');
  assert.ok(s02.reasons.some((r) => r.includes('连续停业') || r.includes('覆盖')), 'mentions closure/coverage');
  assert.ok(s02.closureRun.start !== s02.missingRun.start, 'closure and missing runs are distinct');
  // 停业窗内不得同时标为漏报。
  const win = a.windows.windowDates;
  for (const d of win) {
    assert.ok(!(statusAt(DATA, 'S02', d) === 'closure' && statusAt(DATA, 'S02', d) === 'missing'));
  }
});

test('不符合连续观察范围的门店有排除原因', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  for (const d of a.diagnoses) {
    if (!d.eligible && !d.isSubject) assert.ok(d.reasons.length > 0, `${d.id} should explain why`);
    if (d.eligible) assert.equal(d.reasons.length, 0);
  }
  const s14 = a.diagnoses.find((d) => d.id === 'S14');
  assert.equal(s14.eligible, false);
  assert.ok(s14.reasons.some((r) => r.includes('停业')));
});

test('安慰剂与正式分析使用同一资格集', () => {
  const windows = buildWindows(DATA, STUDY);
  const real = diagnoseAll(DATA, windows, STUDY.store);
  const placebo = diagnoseAll(DATA, windows, 'S12');
  // 对同一分析对象，资格规则完全一致。
  const eligibleReal = real.filter((d) => d.eligible).map((d) => d.id);
  const eligiblePl = placebo.filter((d) => d.eligible).map((d) => d.id);
  assert.deepEqual(eligiblePl, eligibleReal.filter((id) => id !== 'S12'));
  const fit = fitSynthetic(DATA, windows, 'S12', eligiblePl, {});
  assert.ok(fit.ok);
  for (const d of fit.fitDates) assert.ok(windows.preDates.includes(d));
});

test('锁定权重后仍满足约束，且锁定值被保留', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const top = a.current.concentration.topDonor;
  const b = analyzeStudy(DATA, { studyId: STUDY.store, locked: { [top]: 0.4 } });
  assert.ok(b.current.ok);
  near(b.current.weights[top], 0.4, 1e-9, 'locked weight preserved');
  near(Object.values(b.current.weights).reduce((x, y) => x + y, 0), 1, 1e-9);
});

test('排除所有候选时给出明确原因而不是崩溃', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const all = Object.fromEntries(a.eligible.map((id) => [id, 0]));
  const b = analyzeStudy(DATA, { studyId: STUDY.store, excluded: a.eligible });
  assert.equal(b.current.ok, false);
  assert.ok(b.current.reason);
  assert.equal(Object.keys(all).length, a.eligible.length);
});

test('稳定性检验逐一排除正权重候选', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const excludedIds = a.stability.variants.filter((v) => v.excludedId).map((v) => v.excludedId);
  assert.ok(excludedIds.length >= 2);
  for (const id of excludedIds) assert.ok(a.current.weights[id] > 0.01);
  assert.ok(a.stability.variants.every((v) => v.fit.ok));
});

test('主动集解与投影梯度解目标值一致', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const donors = a.eligible;
  const fitA = fitSynthetic(DATA, a.windows, a.subjectId, donors, {});
  const fitB = fitSynthetic(DATA, a.windows, a.subjectId, donors, { solver: solveSimplexProjected });
  near(fitA.preMetric.sse, fitB.preMetric.sse, Math.max(2, fitA.preMetric.sse * 0.002), 'SSE');
});

test('求解器 KKT：正权重梯度相同，零权重不更优', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const fit = a.current;
  const dates = fit.fitDates;
  const y = dates.map((d) => valueAt(DATA, a.subjectId, d));
  const mean = y.reduce((x, z) => x + z, 0) / y.length;
  const ids = fit.donorIds;
  const X = dates.map((d) => ids.map((id) => valueAt(DATA, id, d) / mean));
  const Y = y.map((v) => v / mean);
  const w = ids.map((id) => fit.weights[id]);
  const grad = ids.map((_, j) => 2 * X.reduce((acc, row, i) => acc + (row.reduce((s, v, k) => s + v * w[k], 0) - Y[i]) * row[j], 0));
  const pos = grad.filter((_, j) => w[j] > 1e-6);
  const zeros = grad.filter((_, j) => w[j] <= 1e-6);
  if (pos.length > 1) near(Math.max(...pos), Math.min(...pos), 1e-5, 'gradient on active set');
  if (zeros.length) assert.ok(Math.min(...zeros) >= Math.min(...pos) - 1e-5, 'inactive gradient');
});

test('安慰剂扫描排除有真实活动的门店作为反例', () => {
  const scan = placeboScan(DATA, { studyId: STUDY.store });
  assert.ok(scan.rows.length >= 10);
  for (const r of scan.valid) assert.equal(r.hasActivity, false);
  assert.ok(scan.worst && scan.worst.preMape > 0.1, 'worst placebo has poor pre-fit');
});

test('活动后窗口不与活动前重叠', () => {
  for (const s of DATA.studies) {
    const w = bw(DATA, s);
    assert.ok(w.postStart > w.eventEnd);
    assert.ok(w.preEnd < w.eventStart);
    for (const d of w.postDates) assert.ok(d > w.eventEnd);
    for (const d of w.eventDates) assert.ok(!w.postDates.includes(d));
    assert.equal(w.preDates.length, 56);
    assert.equal(w.postDates.length, 56);
  }
});

test('单日明细的加权合计等于合成值', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const d = a.windows.preDates.find((x) => valueAt(DATA, a.subjectId, x) != null);
  const detail = dayDetail(DATA, a.current, d);
  const sum = detail.contributions.reduce((acc, c) => acc + c.contribution, 0);
  near(sum, detail.synthetic, 0.6, 'synthetic total');
});

test('拟合使用共同观测日：删掉某候选的一天会减少拟合日', () => {
  const a = analyzeStudy(DATA, { studyId: STUDY.store });
  const clone = structuredClone(DATA);
  const donor = a.current.donorIds.find((id) => a.current.weights[id] > 0.05);
  const day = a.current.fitDates[Math.floor(a.current.fitDates.length / 2)];
  delete clone.stores[donor].daily[day].v;
  clone.stores[donor].daily[day] = { status: 'missing' };
  const b = fitSynthetic(clone, a.windows, a.subjectId, a.current.donorIds, {});
  assert.equal(b.fitDates.includes(day), false);
  assert.equal(b.fitDates.length, a.current.fitDates.length - 1);
});
