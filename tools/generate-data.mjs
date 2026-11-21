// 由 data/dataset.json 生成确定性演示数据。每次运行输出完全一致。
// 缺失分两类：closure（停业，门店确实没营业）与 missing（漏报，可能营业了但未上报）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function gauss(rand) {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const inRange = (d, a, b) => d >= a && d <= b;

const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data', 'dataset.json'), 'utf8'));
const { period } = dataset.meta;

const allDates = [];
for (let d = period.start; d <= period.end; d = addDays(d, 1)) allDates.push(d);

const rand = mulberry32(dataset.seed);
const commonShock = new Map();
const cityEvents = dataset.calendarEvents ?? {};
for (const d of allDates) {
  const t = diffDays(period.start, d);
  const seasonal = 0.035 * Math.sin((2 * Math.PI * t) / 112) + 0.018 * Math.sin((2 * Math.PI * t) / 31);
  commonShock.set(d, seasonal + gauss(rand) * 0.018 + (cityEvents[d] ?? 0));
}

const toSet = (list) => new Set(list ?? []);
const closuresByStore = new Map();
for (const [store, [a, b]] of Object.entries(dataset.closureWindows ?? {})) {
  const set = new Set();
  for (let d = a; d <= b; d = addDays(d, 1)) set.add(d);
  closuresByStore.set(store, set);
}
const missingsByStore = new Map();
for (const [store, [a, b]] of Object.entries(dataset.missingWindows ?? {})) {
  const set = new Set();
  for (let d = a; d <= b; d = addDays(d, 1)) set.add(d);
  missingsByStore.set(store, set);
}
for (const [store, list] of Object.entries(dataset.missingDays ?? {})) {
  const set = missingsByStore.get(store) ?? new Set();
  for (const d of list) set.add(d);
  missingsByStore.set(store, set);
}
const eventsByStore = new Map();
for (const ev of [...dataset.promotions.map((p) => ({ ...p, kind: 'promotion' })), ...dataset.treatments.map((t) => ({ ...t, kind: 'treatment' }))]) {
  const arr = eventsByStore.get(ev.store) ?? [];
  arr.push(ev);
  eventsByStore.set(ev.store, arr);
}
const shiftsByStore = new Map();
for (const ls of dataset.levelShifts ?? []) {
  const arr = shiftsByStore.get(ls.store) ?? [];
  arr.push(ls);
  shiftsByStore.set(ls.store, arr);
}

function eventShape(start, end, date) {
  const days = diffDays(start, end) + 1;
  const idx = diffDays(start, date);
  return Math.pow(Math.sin((Math.PI * (idx + 0.5)) / days), 0.7);
}
function promoBoost(storeId, date) {
  let boost = 0;
  for (const p of dataset.promotions) {
    if (p.store === storeId && inRange(date, p.start, p.end)) {
      boost = Math.max(boost, p.lift * eventShape(p.start, p.end, date));
    }
  }
  return boost;
}
function treatmentLift(storeId, date) {
  let lift = 0;
  for (const t of dataset.treatments) {
    if (t.store === storeId && inRange(date, t.start, t.end)) {
      lift = Math.max(lift, t.lift * eventShape(t.start, t.end, date));
    }
  }
  return lift;
}
function localEventDelta(storeId, date) {
  let delta = 0;
  for (const ev of dataset.localEvents ?? []) {
    if (ev.store === storeId && inRange(date, ev.start, ev.end)) delta += ev.delta;
  }
  return delta;
}
function postShift(storeId, date) {
  let shift = 0;
  for (const t of dataset.treatments) {
    if (t.store === storeId && date > t.end && t.postShift) shift = Math.max(shift, t.postShift);
  }
  return shift;
}

const stores = {};
for (const store of dataset.stores) {
  const storeRand = mulberry32(dataset.seed ^ hash(store.id));
  const daily = {};
  for (const date of allDates) {
    const t = diffDays(period.start, date);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const isClosure = closuresByStore.get(store.id)?.has(date) ?? false;
    const isMissing = !isClosure && (missingsByStore.get(store.id)?.has(date) ?? false);
    if (isClosure) { daily[date] = { status: 'closure' }; continue; }
    if (isMissing) { daily[date] = { status: 'missing' }; continue; }

    let level = store.baseline;
    for (const ls of shiftsByStore.get(store.id) ?? []) if (date >= ls.date) level *= ls.factor;
    const growth = Math.pow(1 + store.growth, t);
    const weekday = store.weekday[(dow + 6) % 7]; // 周一..周日
    const shock = commonShock.get(date);
    const noise = gauss(storeRand) * store.noise[0];
    const revenue = Math.round(
      level * growth * weekday * (1 + shock) * (1 + promoBoost(store.id, date)) *
      (1 + treatmentLift(store.id, date)) * (1 + postShift(store.id, date)) *
      (1 + localEventDelta(store.id, date)) * (1 + noise)
    );
    daily[date] = { status: 'observed', v: revenue };
  }
  stores[store.id] = {
    id: store.id, name: store.name, district: store.district,
    format: store.format, opened: store.opened, daily,
  };
}

const out = {
  meta: {
    title: dataset.meta.title,
    period,
    note: dataset.meta.note,
    currency: 'CNY',
    unit: '元/日',
    seed: dataset.seed,
    preDays: dataset.meta.preDays ?? 56,
    postDays: dataset.meta.postDays ?? 56,
    mainTreatmentStore: dataset.treatments[0]?.store ?? null,
  },
  studies: dataset.treatments.map((t) => ({
    store: t.store, start: t.start, end: t.end, name: t.name,
    lift: t.lift, postShift: t.postShift ?? 0,
  })),
  stores,
  promotions: dataset.promotions.map((p) => ({ ...p, kind: 'promotion' })),
  localEvents: (dataset.localEvents ?? []).map((e) => ({ ...e })),
  treatments: dataset.treatments.map((t) => ({ ...t, kind: 'treatment' })),
  closures: Object.entries(dataset.closureWindows ?? {}).map(([store, [start, end]]) => ({ store, start, end })),
  missingWindows: Object.entries(dataset.missingWindows ?? {}).map(([store, [start, end]]) => ({ store, start, end })),
  missingDays: dataset.missingDays ?? {},
  calendarEvents: cityEvents,
  allDates,
};

fs.writeFileSync(path.join(root, 'data', 'stores.json'), JSON.stringify(out), 'utf8');
console.log(`generated ${Object.keys(stores).length} stores × ${allDates.length} days -> data/stores.json`);
for (const s of out.studies) {
  const preStart = addDays(s.start, -out.meta.preDays);
  const postEnd = addDays(s.start, out.meta.postDays - 1);
  console.log(`  study ${s.store} ${s.start}..${s.end}  window ${preStart}..${postEnd}`);
}
