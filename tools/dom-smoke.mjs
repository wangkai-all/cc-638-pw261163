// DOM 冒烟测试：用 jsdom 渲染整个页面，逐项验证可交互契约。
// 用 esbuild 把 JSX 打包成 CJS，再在 jsdom 环境里挂载。
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = RO;
globalThis.ResizeObserver = RO;
// jsdom 没有 PointerEvent；用 MouseEvent 替代，React 的 onPointerMove 仍会收到。
if (!window.PointerEvent) window.PointerEvent = window.MouseEvent;

const localStorageMap = new Map();
const localStorage = {
  getItem: (k) => (localStorageMap.has(k) ? localStorageMap.get(k) : null),
  setItem: (k, v) => localStorageMap.set(k, String(v)),
  removeItem: (k) => localStorageMap.delete(k),
  clear: () => localStorageMap.clear(),
};
Object.defineProperty(window, 'localStorage', { value: localStorage });
globalThis.localStorage = localStorage;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const outfile = '/workspace/node_modules/.cache/dom-app.cjs';
fs.mkdirSync('/workspace/node_modules/.cache', { recursive: true });
await build({
  entryPoints: ['/workspace/src/App.jsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  outfile,
  define: { 'process.env.NODE_ENV': '"development"' },
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
});

const App = require(outfile).default;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react');

const container = document.getElementById('root');
const root = createRoot(container);
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const text = (sel) => $(sel)?.textContent ?? '';

const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push([true, name]);
  } catch (e) {
    checks.push([false, name, e.message]);
  }
};

check('首屏渲染出主标题', () => assert.match(text('.brand-title'), /门店活动效果分析/));
check('主数字存在', () => assert.match(text('.hero-value'), /%|—/));
check('有实际与合成两条折线', () => {
  assert.ok($('.line-actual'));
  assert.ok($('.line-synth'));
});
check('有逐日差距图', () => assert.ok($$('.chart-svg').length >= 2, `found ${$$('.chart-svg').length}`));
check('候选表列出 15 家对照店', () => {
  const rows = $$('table.data')[0].querySelectorAll('tbody tr');
  assert.ok(rows.length >= 15);
});
check('权重行非空且和约为 100%', () => {
  const labels = $$('.weight-val').map((e) => e.textContent).filter((t) => t !== '0%');
  const sum = labels.reduce((a, t) => a + parseFloat(t), 0);
  assert.ok(Math.abs(sum - 100) < 1.5, `sum ${sum}`);
});
check('单日明细默认显示选中日', () => assert.match(text('.inspector-date'), /月/));
check('有集中度结论', () => assert.match(document.body.textContent, /权重较分散|权重集中在单店/));
check('有稳定性结论', () => assert.match(document.body.textContent, /方向一致|翻转/));
check('有安慰剂反例卡', () => assert.match(document.body.textContent, /活动前拟合本来就很差的反例/));
check('有口径说明', () => assert.match(document.body.textContent, /不识别真实因果效应/));

// 点击折线图选日
const svg = $('.chart-svg');
await act(async () => {
  const rect = { left: 0, top: 0, width: 800, height: 232, right: 800, bottom: 232 };
  svg.getBoundingClientRect = () => rect;
  const ev = new window.MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 100 });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  svg.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 20));
});
check('点击图表后单日明细跟随', () => {
  assert.match(text('.inspector-date'), /月/);
  assert.ok($$('.contrib li').length >= 2, 'weighted contributions listed');
});

// 排除权重最大的候选店
const before = text('.hero-value');
const topName = text('.weight-name');
const row = $$('table.data')[0].querySelectorAll('tbody tr');
const target = [...row].find((tr) => tr.textContent.includes(topName.trim()));
assert.ok(target, 'top donor row found');
const excludeBtn = [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === '排除');
await act(async () => {
  excludeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
});
check('排除候选后结果重算', () => {
  const after = text('.hero-value');
  assert.notEqual(after, before);
  assert.match(document.body.textContent, /手动排除/);
});
check('排除后仍满足权重和', () => {
  const labels = $$('.weight-val').map((e) => e.textContent).filter((t) => t !== '0%');
  const sum = labels.reduce((a, t) => a + parseFloat(t), 0);
  assert.ok(Math.abs(sum - 100) < 2.5, `sum ${sum}`);
});

// 锁定一家
const input = $('.weight-input');
await act(async () => {
  input.value = '30';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
});
check('锁定权重生效', () => {
  assert.ok($('.weight-row.locked'), 'locked row exists');
  assert.match(document.body.textContent, /30\.0%/);
});

// 安慰剂模式
const placeboBtn = $$('.seg-btn').find((b) => b.textContent.includes('安慰剂'));
await act(async () => {
  placeboBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
});
check('安慰剂模式切换', () => assert.match(document.body.textContent, /安慰剂模式/));
check('安慰剂模式有对象选择器', () => assert.ok($('#placebo-select')));

// 安慰剂反例按钮
const worstBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('把它设为安慰剂对象'));
await act(async () => {
  worstBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
});
check('反例可设为安慰剂对象', () => assert.match(document.body.textContent, /安慰剂模式/));

// 方法弹窗
const methodBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '方法与口径');
await act(async () => {
  methodBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
});
check('方法弹窗可打开', () => assert.ok($('[role="dialog"]')));
check('方法弹窗含口径表', () => assert.match($('[role="dialog"]').textContent, /非负权重|Φ|Σ w/));
await act(async () => {
  const close = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === '关闭');
  close.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
});
check('方法弹窗可关闭', () => assert.equal($('[role="dialog"]'), null));

// 表格视图
const tableBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('展开'));
await act(async () => {
  tableBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
});
check('表格视图可展开', () => {
  const tables = $$('table.data');
  assert.ok(tables.length >= 2);
  assert.match(tables[0].textContent, /实际|不可比/);
});

const failed = checks.filter(([ok]) => !ok);
for (const [ok, name, msg] of checks) console.log(`${ok ? '✔' : '✖'} ${name}${msg ? ` — ${msg}` : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exitCode = 1;
await act(async () => { root.unmount(); });
