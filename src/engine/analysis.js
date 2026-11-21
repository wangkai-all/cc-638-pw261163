// 合成对照分析引擎（纯函数，无 DOM 依赖）。
// 口径：每日营业交易额。权重只用活动开始之前、且分析对象与全部对照当日都有观测的日期。
// 活动期与活动后的数值只用于画差距，绝不参与权重选择。

import { solveSimplexExact } from './solver.js';

export const DAY_MS = 86400000;

export const iso = (d) => d.toISOString().slice(0, 10);
export const parseDate = (s) => new Date(s + 'T00:00:00Z');
export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
export const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
export const inRange = (d, a, b) => d >= a && d <= b;

export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export function weekdayCN(date) {
  return WEEKDAYS[(parseDate(date).getUTCDay() + 6) % 7];
}
export function fmtDateCN(date) {
  const d = parseDate(date);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}
export function fmtDateFull(date) {
  const d = parseDate(date);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}
export function fmtDateShort(date) {
  const d = parseDate(date);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function fmtMoney(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('zh-CN');
}
export function fmtPct(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}
export function fmtSignedPct(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(digits)}%`;
}
export function fmtSignedMoney(v) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('zh-CN')}`;
}

export function getStudy(DATA, studyId) {
  return DATA.studies.find((s) => s.store === studyId) ?? DATA.studies[0];
}

export function statusAt(DATA, storeId, date) {
  return DATA.stores[storeId]?.daily?.[date]?.status ?? 'out';
}

export function valueAt(DATA, storeId, date) {
  const rec = DATA.stores[storeId]?.daily?.[date];
  return rec?.status === 'observed' ? rec.v : null;
}

export function storeActivities(DATA, storeId) {
  const out = [];
  for (const p of DATA.promotions ?? []) if (p.store === storeId) out.push({ ...p, kind: 'promotion' });
  for (const t of DATA.treatments ?? []) if (t.store === storeId) out.push({ ...t, kind: 'treatment' });
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function storeLocalEvents(DATA, storeId) {
  return (DATA.localEvents ?? []).filter((e) => e.store === storeId);
}

function runs(dates, predicate) {
  let best = null;
  let cur = null;
  for (const d of dates) {
    if (predicate(d)) {
      if (!cur) cur = { start: d, end: d, length: 0 };
      cur.end = d;
      cur.length += 1;
      if (!best || cur.length > best.length) best = { ...cur };
    } else {
      cur = null;
    }
  }
  return best;
}

export function buildWindows(DATA, study, opts = {}) {
  const preDays = opts.preDays ?? DATA.meta.preDays ?? 56;
  const postDays = opts.postDays ?? DATA.meta.postDays ?? 56;
  const preStart = addDays(study.start, -preDays);
  const preEnd = addDays(study.start, -1);
  // 活动后窗口从活动结束次日开始，与活动期严格不重叠。
  const postStart = addDays(study.end, 1);
  const postEnd = addDays(postStart, postDays - 1);
  return {
    preDays,
    postDays,
    preStart,
    preEnd,
    eventStart: study.start,
    eventEnd: study.end,
    postStart,
    postEnd,
    preDates: dateRange(preStart, preEnd),
    eventDates: dateRange(study.start, study.end),
    postDates: dateRange(postStart, postEnd),
    windowDates: dateRange(preStart, postEnd),
  };
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && aEnd >= bStart;

export const COVERAGE_MIN = 0.9;
export const MAX_RUN = 7;
export const MIN_PRE_OBS = 14;

/**
 * 对照资格诊断。规则与拟合/安慰剂完全同源：
 * - 窗口内没有活动、本地冲击或经营水平变化；
 * - 活动前、活动后两个观察期的观测覆盖率均 >= 90%；
 * - 连续停业或连续漏报均不超过 7 天（两类分开统计、分开给出原因）。
 * 注意：这里只看“是否被处理 + 是否看得清”，不看结果，避免用活动后表现挑选对照。
 */
export function diagnoseStore(DATA, storeId, windows, { subjectId = null } = {}) {
  const meta = DATA.stores[storeId];
  const observed = (d) => statusAt(DATA, storeId, d) === 'observed';
  const closure = (d) => statusAt(DATA, storeId, d) === 'closure';
  const missing = (d) => statusAt(DATA, storeId, d) === 'missing';
  const win = windows.windowDates;

  const activities = storeActivities(DATA, storeId).filter((e) =>
    overlaps(e.start, e.end, windows.preStart, windows.postEnd)
  );
  const selfStudy = activities.find(
    (e) => e.kind === 'treatment' && e.start === windows.eventStart && e.end === windows.eventEnd
  );
  const otherActivities = storeId === subjectId ? activities.filter((e) => e !== selfStudy) : activities;
  const localEvents = storeLocalEvents(DATA, storeId).filter((e) =>
    overlaps(e.start, e.end, windows.preStart, windows.postEnd)
  );
  const shifts = (DATA.levelShifts ?? []).filter(
    (s) => s.store === storeId && inRange(s.date, windows.preStart, windows.postEnd)
  );

  const preObserved = windows.preDates.filter(observed).length;
  const postObserved = windows.postDates.filter(observed).length;
  const closureDates = win.filter(closure);
  const missingDates = win.filter(missing);
  const closureRun = runs(win, closure);
  const missingRun = runs(win, missing);
  const coveragePre = windows.preDates.length ? preObserved / windows.preDates.length : 0;
  const coveragePost = windows.postDates.length ? postObserved / windows.postDates.length : 0;

  const reasons = [];
  for (const e of otherActivities) {
    const label = e.kind === 'promotion' ? '店内活动' : '另一场活动';
    reasons.push(`${label}「${e.name}」${fmtDateCN(e.start)}–${fmtDateCN(e.end)}与观察窗口重叠`);
  }
  for (const e of localEvents) {
    reasons.push(`本地冲击${e.note ? `：${e.note}（${fmtDateCN(e.start)}–${fmtDateCN(e.end)}）` : `（${fmtDateCN(e.start)}–${fmtDateCN(e.end)}）`}`);
  }
  for (const s of shifts) {
    reasons.push(`经营水平变化${s.note ? `（${s.note}）` : ''}发生于${fmtDateCN(s.date)}`);
  }
  if (preObserved < MIN_PRE_OBS) {
    reasons.push(`活动前仅 ${preObserved} 天有观测，少于 ${MIN_PRE_OBS} 天`);
  } else if (coveragePre < COVERAGE_MIN) {
    reasons.push(`活动前观测覆盖 ${(coveragePre * 100).toFixed(0)}%，低于 ${COVERAGE_MIN * 100}%`);
  }
  if (postObserved < MIN_PRE_OBS) {
    reasons.push(`活动后仅 ${postObserved} 天有观测，少于 ${MIN_PRE_OBS} 天`);
  } else if (coveragePost < COVERAGE_MIN) {
    reasons.push(`活动后观测覆盖 ${(coveragePost * 100).toFixed(0)}%，低于 ${COVERAGE_MIN * 100}%`);
  }
  if (missingRun && missingRun.length > MAX_RUN) {
    reasons.push(`连续漏报 ${missingRun.length} 天（${fmtDateCN(missingRun.start)}–${fmtDateCN(missingRun.end)}）`);
  }
  if (closureRun && closureRun.length > MAX_RUN) {
    reasons.push(`连续停业 ${closureRun.length} 天（${fmtDateCN(closureRun.start)}–${fmtDateCN(closureRun.end)}）`);
  }

  const isSubject = storeId === subjectId;
  return {
    id: storeId,
    name: meta.name,
    district: meta.district,
    format: meta.format,
    opened: meta.opened,
    isSubject,
    eligible: !isSubject && reasons.length === 0,
    reasons,
    activities: isSubject ? activities : otherActivities,
    localEvents,
    shifts,
    coveragePre,
    coveragePost,
    preObserved,
    postObserved,
    closureDays: closureDates.length,
    missingDays: missingDates.length,
    closureRun,
    missingRun,
    closureDates,
    missingDates,
  };
}

export function diagnoseAll(DATA, windows, subjectId) {
  return Object.keys(DATA.stores)
    .map((id) => diagnoseStore(DATA, id, windows, { subjectId }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * 拟合合成对照。
 * @param {object} DATA
 * @param {object} windows buildWindows 结果
 * @param {string} subjectId 分析对象（活动店或安慰剂对象）
 * @param {string[]} donorIds 通过资格规则、允许进入权重的候选店
 * @param {{locked?: Record<string, number>, excluded?: string[]}} opts
 *   locked 中只允许“已确认有资格”的候选店；excluded 为用户手动排除的候选店。
 */
export function fitSynthetic(DATA, windows, subjectId, donorIds, { locked = {}, excluded = [], solver = solveSimplexExact } = {}) {
  const excludedSet = new Set(excluded);
  const eligibleDonors = donorIds.filter((id) => !excludedSet.has(id) && id !== subjectId);
  const lockedEntries = Object.entries(locked).filter(
    ([id, w]) => eligibleDonors.includes(id) && Number.isFinite(w) && w > 0
  );
  let lockedSum = lockedEntries.reduce((a, [, w]) => a + w, 0);
  if (lockedSum > 1) {
    for (const e of lockedEntries) e[1] /= lockedSum;
    lockedSum = 1;
  }
  const lockedIds = new Set(lockedEntries.map(([id]) => id));
  const freeDonors = eligibleDonors.filter((id) => !lockedIds.has(id));
  const donorOrder = eligibleDonors; // 列顺序与展示顺序一致

  // 只要分析对象与全部候选店当日都有观测，该日才进入“共同观测拟合集”。
  const fitDates = [];
  const y = [];
  const rows = [];
  for (const d of windows.preDates) {
    const rec = DATA.stores[subjectId]?.daily?.[d];
    if (rec?.status !== 'observed') continue;
    const row = [];
    let complete = true;
    for (const id of donorOrder) {
      const v = valueAt(DATA, id, d);
      if (v == null) { complete = false; break; }
      row.push(v);
    }
    if (!complete) continue;
    fitDates.push(d);
    y.push(rec.v);
    rows.push(row);
  }

  const fitObservedCounts = {};
  for (const id of donorOrder) fitObservedCounts[id] = windows.preDates.filter((d) => valueAt(DATA, id, d) != null).length;

  const base = {
    subjectId,
    donorIds: donorOrder,
    excluded: [...excludedSet],
    locked: Object.fromEntries(lockedEntries),
    fitDates,
    fitObservedCounts,
    weights: Object.fromEntries(donorOrder.map((id) => [id, 0])),
    preMetric: null,
    post: null,
    event: null,
    concentration: null,
    ok: false,
    reason: null,
  };
  if (!donorOrder.length) {
    base.reason = '没有同时满足资格与共同观测要求的对照门店。';
    return base;
  }
  if (fitDates.length < MIN_PRE_OBS) {
    base.reason = `活动前可用于拟合的共同观测日只有 ${fitDates.length} 天（需要至少 ${MIN_PRE_OBS} 天）。`;
    return base;
  }
  if (!freeDonors.length && lockedSum < 1 - 1e-9) {
    base.reason = '所有候选对照均被排除或锁定，剩余权重无法分配。';
    return base;
  }

  // 为数值稳定按 y 均值缩放整张表；权重求解对整体缩放不敏感。
  let w = new Array(donorOrder.length).fill(0);
  lockedEntries.forEach(([id, val]) => { w[donorOrder.indexOf(id)] = val; });

  if (freeDonors.length) {
    const freeMass = Math.max(0, 1 - lockedSum);
    if (freeMass > 1e-9) {
      const freeIdx = freeDonors.map((id) => donorOrder.indexOf(id));
      const lockedIdx = lockedEntries.map(([id]) => donorOrder.indexOf(id));
      const scale = y.reduce((a, b) => a + b, 0) / y.length;
      const X = rows.map((row) => freeIdx.map((j) => row[j] / scale));
      const yAdj = rows.map((row, i) => {
        let s = 0;
        for (let k = 0; k < lockedIdx.length; k++) s += row[lockedIdx[k]] * lockedEntries[k][1];
        return (y[i] - s) / scale / freeMass;
      });
      const wf = solver(X, yAdj);
      freeIdx.forEach((j, k) => { w[j] = wf[k] * freeMass; });
    }
  }
  const total = w.reduce((a, b) => a + b, 0);
  w = w.map((v) => (total > 0 ? v / total : v));
  donorOrder.forEach((id, j) => { base.weights[id] = w[j]; });

  const activeDonors = donorOrder.filter((id) => base.weights[id] > 1e-4).length;
  const weightsSq = donorOrder.reduce((a, id) => a + base.weights[id] ** 2, 0);
  const top = [...donorOrder].sort((a, b) => base.weights[b] - base.weights[a])[0];

  const predict = (date) => {
    const subj = DATA.stores[subjectId]?.daily?.[date];
    if (subj?.status !== 'observed') {
      return { date, status: 'subject-missing', subjectStatus: subj?.status ?? 'out' };
    }
    let synth = 0;
    let covered = 0;
    const contributions = [];
    for (const id of donorOrder) {
      const weight = base.weights[id];
      if (weight <= 0) continue;
      const rec = DATA.stores[id]?.daily?.[date];
      const value = rec?.status === 'observed' ? rec.v : null;
      if (value == null) {
        return {
          date,
          status: 'donor-missing',
          subjectStatus: 'observed',
          missingDonor: id,
          missingStatus: rec?.status ?? 'out',
        };
      }
      synth += value * weight;
      covered += weight;
      contributions.push({ id, weight, value, contribution: value * weight });
    }
    if (covered < 1 - 1e-6) return { date, status: 'donor-missing', subjectStatus: 'observed' };
    return {
      date,
      status: 'ok',
      subjectStatus: 'observed',
      actual: subj.v,
      synthetic: synth,
      gap: subj.v - synth,
      gapPct: synth ? (subj.v - synth) / synth : null,
      contributions: contributions.sort((a, b) => b.contribution - a.contribution),
    };
  };

  const preSeries = windows.preDates.map(predict);
  const eventSeries = windows.eventDates.map(predict);
  const postSeries = windows.postDates.map(predict);

  const fitPre = preSeries.filter((d) => d.status === 'ok');
  const sse = fitPre.reduce((a, d) => a + d.gap * d.gap, 0);
  const rmse = Math.sqrt(sse / Math.max(1, fitPre.length));
  const mape = fitPre.reduce((a, d) => a + Math.abs(d.gap) / d.actual, 0) / Math.max(1, fitPre.length);
  const meanActual = fitPre.reduce((a, d) => a + d.actual, 0) / Math.max(1, fitPre.length);
  const sst = fitPre.reduce((a, d) => a + (d.actual - meanActual) ** 2, 0);
  const bias = fitPre.reduce((a, d) => a + d.gap, 0) / Math.max(1, fitPre.length);

  const summarize = (series) => {
    const ok = series.filter((d) => d.status === 'ok');
    const actualSum = ok.reduce((a, d) => a + d.actual, 0);
    const syntheticSum = ok.reduce((a, d) => a + d.synthetic, 0);
    const gapSum = actualSum - syntheticSum;
    return {
      n: ok.length,
      actualSum,
      syntheticSum,
      gapSum,
      meanGap: ok.length ? gapSum / ok.length : null,
      meanActual: ok.length ? actualSum / ok.length : null,
      meanSynthetic: ok.length ? syntheticSum / ok.length : null,
      relativeGap: syntheticSum ? gapSum / syntheticSum : null,
      unavailable: series.filter((d) => d.status !== 'ok'),
    };
  };

  base.ok = true;
  base.preSeries = preSeries;
  base.eventSeries = eventSeries;
  base.postSeries = postSeries;
  base.fitPre = fitPre;
  base.nComp = fitPre.length;
  base.preMetric = { n: fitPre.length, rmse, mape, bias, r2: sst > 0 ? 1 - sse / sst : null, meanActual, sse };
  base.event = summarize(eventSeries);
  base.post = summarize(postSeries);
  base.concentration = {
    topDonor: top ?? null,
    topWeight: top ? base.weights[top] : 0,
    hhi: weightsSq,
    effectiveDonors: weightsSq > 0 ? 1 / weightsSq : 0,
    activeDonors,
    dominant: weightsSq > 0 && (base.weights[top] >= 0.5 || 1 / weightsSq < 2.5),
  };
  base.predict = predict;
  return base;
}

export function dayDetail(DATA, fit, date) {
  const subjectRec = DATA.stores[fit.subjectId]?.daily?.[date];
  const contributions = [];
  let synth = 0;
  for (const [id, weight] of Object.entries(fit.weights)) {
    if (weight <= 1e-6) continue;
    const rec = DATA.stores[id]?.daily?.[date];
    const value = rec?.status === 'observed' ? rec.v : null;
    contributions.push({
      id,
      name: DATA.stores[id].name,
      weight,
      value,
      contribution: value == null ? null : value * weight,
      status: rec?.status ?? 'out',
    });
    if (value != null) synth += value * weight;
  }
  contributions.sort((a, b) => (b.contribution ?? -1) - (a.contribution ?? -1));
  const actual = subjectRec?.status === 'observed' ? subjectRec.v : null;
  return {
    date,
    weekday: weekdayCN(date),
    actual,
    synthetic: actual == null ? null : synth,
    gap: actual == null ? null : actual - synth,
    subjectStatus: subjectRec?.status ?? 'out',
    contributions,
  };
}

/**
 * 完整分析：基线拟合、当前设置拟合、以及“逐一排除”的稳定性检验。
 */
export function analyzeStudy(DATA, {
  studyId,
  mode = 'actual',
  placeboSubjectId = null,
  excluded = [],
  locked = {},
} = {}) {
  const study = getStudy(DATA, studyId);
  const subjectId = mode === 'placebo' ? placeboSubjectId : study.store;
  if (!subjectId) throw new Error('placebo 模式需要指定 placeboSubjectId');
  const windows = buildWindows(DATA, study);
  const diagnoses = diagnoseAll(DATA, windows, subjectId);
  const eligible = diagnoses.filter((d) => d.eligible).map((d) => d.id);
  const subjectDiag = diagnoses.find((d) => d.id === subjectId);

  const filteredExcluded = excluded.filter((id) => id !== subjectId && eligible.includes(id));
  const filteredLocked = Object.fromEntries(
    Object.entries(locked).filter(([id]) => id !== subjectId && eligible.includes(id))
  );

  const baseline = fitSynthetic(DATA, windows, subjectId, eligible, {});
  const current = fitSynthetic(DATA, windows, subjectId, eligible, {
    excluded: filteredExcluded,
    locked: filteredLocked,
  });

  const variants = [];
  if (current.ok) {
    variants.push({ label: '当前对照集', note: '按当前排除与锁定设置', fit: current, isCurrent: true });
    const active = eligible
      .filter((id) => current.weights[id] > 0.01 && !filteredLocked[id])
      .sort((a, b) => current.weights[b] - current.weights[a]);
    for (const id of active) {
      const fit = fitSynthetic(DATA, windows, subjectId, eligible, {
        excluded: [...filteredExcluded, id],
      });
      if (fit.ok) {
        variants.push({
          label: `排除${DATA.stores[id].name}`,
          note: `该店原权重 ${fmtPct(current.weights[id])}`,
          fit,
          excludedId: id,
        });
      }
    }
  }
  const gapPcts = variants.filter((v) => v.fit.ok && v.fit.post?.relativeGap != null).map((v) => v.fit.post.relativeGap);
  const lo = gapPcts.length ? Math.min(...gapPcts) : null;
  const hi = gapPcts.length ? Math.max(...gapPcts) : null;
  const signStable = gapPcts.length ? gapPcts.every((v) => Math.sign(v) === Math.sign(gapPcts[0])) : null;
  const baselineGap = baseline.ok ? baseline.post.relativeGap : null;

  return {
    study,
    windows,
    subjectId,
    mode,
    diagnoses,
    subjectDiag,
    eligible,
    excluded: filteredExcluded,
    locked: filteredLocked,
    baseline,
    current,
    stability: {
      variants,
      min: lo,
      max: hi,
      signStable,
      baselineGap,
      // 结论在排除单店后仍保持方向且幅度变化 < 1/3 视为稳定。
      robust: signStable === true && lo != null && Math.abs(hi - lo) <= Math.max(0.02, Math.abs(current.post?.relativeGap ?? 0) / 3),
    },
  };
}

/**
 * 安慰剂扫描：把每家门店轮流当作“活动对象”，窗口、资格规则、拟合口径完全相同。
 * 用于回答“如果这家店没做活动，方法会报告什么”。
 */
export function placeboScan(DATA, { studyId } = {}) {
  const study = getStudy(DATA, studyId);
  const windows = buildWindows(DATA, study);
  const rows = [];
  for (const id of Object.keys(DATA.stores)) {
    if (id === study.store) continue;
    const diagAll = diagnoseAll(DATA, windows, id);
    const donors = diagAll.filter((d) => d.eligible).map((d) => d.id);
    const subjectDiag = diagAll.find((d) => d.id === id);
    const fit = donors.length ? fitSynthetic(DATA, windows, id, donors, {}) : null;
    rows.push({
      id,
      name: DATA.stores[id].name,
      fit,
      subjectDiag,
      // 该店在窗口内是否有真实活动：有则不能作为“无活动”的反事实证据。
      hasActivity: subjectDiag.activities.length > 0,
      preMape: fit?.preMetric?.mape ?? null,
      preR2: fit?.preMetric?.r2 ?? null,
      postGap: fit?.post?.relativeGap ?? null,
      skipped: fit?.ok ? null : fit?.reason ?? '无可用对照',
    });
  }
  const valid = rows.filter((r) => r.fit?.ok && !r.hasActivity);
  const worst = valid.slice().sort((a, b) => b.preMape - a.preMape)[0] ?? null;
  return { rows, worst, valid };
}

export function observedDates(DATA, storeId) {
  return Object.entries(DATA.stores[storeId].daily)
    .filter(([, r]) => r.status === 'observed')
    .map(([d]) => d);
}
