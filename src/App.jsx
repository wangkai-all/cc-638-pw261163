import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import DATA from '../data/stores.json';
import {
  analyzeStudy, buildWindows, dayDetail, diagnoseAll, fitSynthetic, getStudy,
  fmtDateCN, fmtDateFull, fmtPct, fmtSignedMoney, fmtSignedPct,
  statusAt, valueAt,
} from './engine/analysis.js';
import { GapChart, LevelChart } from './components/Charts.jsx';
import { Banner, Chip } from './components/ui.jsx';
import CandidateTable from './components/CandidateTable.jsx';
import DayInspector from './components/DayInspector.jsx';
import PlaceboPanel from './components/PlaceboPanel.jsx';
import StabilityPanel from './components/StabilityPanel.jsx';
import WeightPanel from './components/WeightPanel.jsx';
import MethodDialog from './components/MethodDialog.jsx';
import DailyTable from './components/DailyTable.jsx';

const STORAGE_KEY = 'campaign-synth-state-v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DEFAULT_STATE = {
  studyId: DATA.studies[0].store,
  subjectId: DATA.studies[0].store,
  mode: 'actual',
  selectedDate: DATA.studies[0].start,
  excludedByStudy: {},
  lockedByStudy: {},
  placeboSubjectByStudy: {},
  theme: 'system',
  tab: 'candidates',
};

export default function App() {
  const saved = useMemo(loadState, []);
  const [state, setState] = useState(() => ({ ...DEFAULT_STATE, ...(saved ?? {}) }));
  const [methodOpen, setMethodOpen] = useState(false);

  const update = useCallback((patch) => {
    setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 忽略配额错误 */ }
    }, 300);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  const study = getStudy(DATA, state.studyId);
  const windows = useMemo(() => buildWindows(DATA, study), [study]);
  const mode = state.mode;
  const storedPlacebo = state.placeboSubjectByStudy[state.studyId];
  const placeboSubjectId = storedPlacebo && storedPlacebo !== study.store
    ? storedPlacebo
    : Object.keys(DATA.stores).find((id) => id !== study.store);
  const subjectId = mode === 'placebo' ? placeboSubjectId : study.store;

  const excluded = state.excludedByStudy[state.studyId] ?? [];
  const locked = state.lockedByStudy[state.studyId] ?? {};

  const analysis = useMemo(
    () => analyzeStudy(DATA, { studyId: state.studyId, mode, placeboSubjectId: mode === 'placebo' ? subjectId : null, excluded, locked }),
    [state.studyId, mode, subjectId, excluded, locked]
  );

  const dates = windows.windowDates;
  const selectedDate = dates.includes(state.selectedDate) ? state.selectedDate : study.start;

  const setSelectedDate = useCallback((d) => update({ selectedDate: d }), [update]);
  const setStudy = useCallback((studyId) => {
    const st = getStudy(DATA, studyId);
    const w = buildWindows(DATA, st);
    update({ studyId, subjectId: st.store, selectedDate: st.start, mode: 'actual' });
  }, [update]);

  const toggleExclude = useCallback((id) => {
    setState((s) => {
      const list = s.excludedByStudy[s.studyId] ?? [];
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      const locks = { ...(s.lockedByStudy[s.studyId] ?? {}) };
      if (next.includes(id)) delete locks[id];
      return {
        ...s,
        excludedByStudy: { ...s.excludedByStudy, [s.studyId]: next },
        lockedByStudy: { ...s.lockedByStudy, [s.studyId]: locks },
      };
    });
  }, []);

  const setLock = useCallback((id, weight) => {
    setState((s) => {
      const locks = { ...(s.lockedByStudy[s.studyId] ?? {}) };
      if (weight == null || weight <= 0) delete locks[id];
      else locks[id] = Math.min(1, Math.max(0, weight));
      return {
        ...s,
        excludedByStudy: {
          ...s.excludedByStudy,
          [s.studyId]: (s.excludedByStudy[s.studyId] ?? []).filter((x) => x !== id),
        },
        lockedByStudy: { ...s.lockedByStudy, [s.studyId]: locks },
      };
    });
  }, []);

  const setPlaceboSubject = useCallback((id) => {
    setState((s) => ({
      ...s,
      mode: 'placebo',
      placeboSubjectByStudy: { ...s.placeboSubjectByStudy, [s.studyId]: id },
    }));
  }, []);

  const resetControls = useCallback(() => {
    setState((s) => ({
      ...s,
      excludedByStudy: { ...s.excludedByStudy, [s.studyId]: [] },
      lockedByStudy: { ...s.lockedByStudy, [s.studyId]: {} },
    }));
  }, []);

  const fit = analysis.current;
  const detail = useMemo(
    () => (fit.ok ? dayDetail(DATA, fit, selectedDate) : null),
    [fit, selectedDate]
  );

  const subjectStore = DATA.stores[subjectId];
  const observedWindow = windows.windowDates.filter((d) => valueAt(DATA, subjectId, d) != null).length;

  const chartDates = dates;
  const placeboSubjectHasActivity = mode === 'placebo'
    && (analysis.subjectDiag?.activities?.length ?? 0) > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l5-6 4 3 5-7 4 5" /><path d="M3 21h18" />
              </svg>
            </div>
            <div>
              <div className="brand-title">门店活动效果分析</div>
              <div className="brand-sub">合成对照 · 虚构演示数据 · 不承诺因果</div>
            </div>
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setMethodOpen(true)}>方法与口径</button>
            <button
              className="icon-btn"
              aria-label={state.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              title="切换主题"
              onClick={() => update({ theme: state.theme === 'dark' ? 'light' : 'dark' })}
            >
              {state.theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4.2" />
                  <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="controlbar" role="region" aria-label="分析设置">
          <div className="field">
            <label className="field-label" htmlFor="study-select">分析活动</label>
            <select
              id="study-select"
              className="select"
              value={state.studyId}
              onChange={(e) => setStudy(e.target.value)}
            >
              {DATA.studies.map((s) => (
                <option key={s.store} value={s.store}>
                  {DATA.stores[s.store].name} ·「{s.name}」{fmtDateCN(s.start)}–{fmtDateCN(s.end)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">分析对象</span>
            <div className="seg" role="group" aria-label="分析对象">
              <button
                className="seg-btn"
                aria-pressed={mode === 'actual'}
                onClick={() => update({ mode: 'actual' })}
              >活动门店</button>
              <button
                className="seg-btn"
                aria-pressed={mode === 'placebo'}
                onClick={() => update({ mode: 'placebo' })}
              >安慰剂对照店</button>
            </div>
          </div>
          {mode === 'placebo' ? (
            <div className="field">
              <label className="field-label" htmlFor="placebo-select">假装做了活动的门店</label>
              <select
                id="placebo-select"
                className="select"
                value={subjectId}
                onChange={(e) => setPlaceboSubject(e.target.value)}
              >
                {Object.values(DATA.stores)
                  .filter((s) => s.id !== study.store)
                  .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ) : null}
          <div className="field">
            <span className="field-label">窗口</span>
            <div className="chip chip-neutral" style={{ height: 36, padding: '0 12px', borderRadius: 9 }}>
              <span className="tnum">活动前 {windows.preDays} 天 · 活动后 {windows.postDays} 天</span>
            </div>
          </div>
          <div className="control-meta">
            <Chip tone="neutral" icon="calendar">
              {fmtDateCN(windows.preStart)} – {fmtDateCN(windows.postEnd)}
            </Chip>
            {excluded.length || Object.keys(locked).length ? (
              <button className="btn btn-sm" onClick={resetControls}>清除排除/锁定</button>
            ) : null}
          </div>
        </div>

        {mode === 'placebo' ? (
          <Banner
            tone={placeboSubjectHasActivity ? 'warn' : 'info'}
            title={`安慰剂模式：把「${subjectStore.name}」当作活动对象`}
            body={placeboSubjectHasActivity
              ? '注意：这家店在观察窗口内有自己的活动，不是干净的安慰剂对象。结果只能作为“拟合很差会怎样”的演示，不能当作无活动的反事实。'
              : '它的真实交易里没有这场活动。窗口、候选资格、拟合与差距计算与真实分析完全相同——用来观察在没有活动时，方法会报出多大的“效应”。'}
            actions={<button className="btn btn-sm" onClick={() => update({ mode: 'actual' })}>返回真实分析</button>}
          />
        ) : null}
        {!fit.ok ? (
          <Banner
            tone="bad"
            title="当前设置下无法完成拟合"
            body={fit.reason}
            actions={<button className="btn btn-sm" onClick={resetControls}>恢复默认对照集</button>}
          />
        ) : null}

        <section className="grid-hero" aria-label="关键数字">
          <div className="card hero">
            <div className="eyebrow">活动后差距 · {mode === 'placebo' ? '安慰剂' : '活动后观察期'}</div>
            <div className="hero-label">
              {fit.ok
                ? `活动结束后 ${windows.postDays} 天，实际比合成对照${fit.post.relativeGap >= 0 ? '高' : '低'}`
                : '暂不可用'}
            </div>
            <div className="hero-value">
              {fit.ok ? fmtSignedPct(fit.post.relativeGap, 1) : '—'}
            </div>
            <div className="hero-delta">
              {fit.ok ? (
                <>
                  <span className="tnum">{fmtSignedMoney(fit.post.gapSum)} 元</span>
                  <span className="muted">合计差额（{fit.post.n} 天可比）</span>
                </>
              ) : null}
            </div>
            <div className="hero-strip" aria-hidden="true">
              {chartDates.map((d) => {
                const cls = d >= study.start && d <= study.end ? 'event' : valueAt(DATA, subjectId, d) != null ? 'on' : '';
                return <span key={d} className={cls} />;
              })}
            </div>
            <div className="hero-note">
              差距 = 实际 − 加权合成对照；它不等于因果效应。{observedWindow < dates.length ? `${dates.length - observedWindow} 天因分析对象停业/漏报或对照缺数未计入。` : ''}
            </div>
          </div>

          <div className="card stat">
            <div className="eyebrow">活动期 · 逐日</div>
            <div className="stat-label">活动期间的实际与合成差距</div>
            <div className="stat-value" style={{ color: fit.ok && fit.event.relativeGap >= 0 ? 'var(--actual)' : undefined }}>
              {fit.ok ? fmtSignedPct(fit.event.relativeGap, 1) : '—'}
            </div>
            <div className="stat-sub">
              {fit.ok ? `${fmtSignedMoney(fit.event.meanGap)} 元/日 · ${fit.event.n} 天可比` : '—'}
            </div>
            <div className="stat-flag">
              <Chip tone="neutral">活动期不参与挑权重</Chip>
            </div>
          </div>

          <div className="card stat">
            <div className="eyebrow">活动前拟合</div>
            <div className="stat-label">共同观测日的平均绝对误差</div>
            <div className="stat-value">{fit.ok ? fmtPct(fit.preMetric.mape, 1) : '—'}</div>
            <div className="stat-sub">
              {fit.ok ? (
                <>R² {fit.preMetric.r2 == null ? '—' : fit.preMetric.r2.toFixed(2)} · {fit.preMetric.n} 个拟合日</>
              ) : '—'}
            </div>
            <div className="stat-flag">
              {fit.ok ? (
                fit.preMetric.mape <= 0.06
                  ? <Chip tone="good">拟合较好</Chip>
                  : fit.preMetric.mape <= 0.12
                    ? <Chip tone="warn">拟合一般</Chip>
                    : <Chip tone="bad">活动前拟合很差</Chip>
              ) : null}
            </div>
            <div className="stat-sub" style={{ marginTop: 2 }}>
              活动后差距只在可比时解释
            </div>
          </div>

          <div className="card stat">
            <div className="eyebrow">候选对照</div>
            <div className="stat-label">进入权重求解的门店</div>
            <div className="stat-value">
              {analysis.eligible.length}<small>/ {Object.keys(DATA.stores).length - 1} 家</small>
            </div>
            <div className="stat-sub">
              {excluded.length ? `手动排除 ${excluded.length} 家` : '未手动排除'} · {analysis.diagnoses.filter((d) => !d.eligible && !d.isSubject).length} 家不符合资格
            </div>
            <div className="stat-flag">
              {fit.ok && fit.concentration.dominant
                ? <Chip tone="warn" icon="alert">权重集中在单店</Chip>
                : fit.ok
                  ? <Chip tone="good">权重较分散</Chip>
                  : null}
            </div>
          </div>
        </section>

        <div className="grid-main">
          <div className="stack">
            <LevelChart
              dates={chartDates}
              fit={fit}
              windows={windows}
              subjectId={subjectId}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              mode={mode}
            />
            {fit.ok ? (
              <GapChart
                dates={chartDates}
                fit={fit}
                windows={windows}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                mode={mode}
              />
            ) : null}
            <DailyTable
              fit={fit}
              windows={windows}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
            <div className="card">
              <CandidateTable
                analysis={analysis}
                excluded={excluded}
                locked={locked}
                onToggleExclude={toggleExclude}
                onLock={setLock}
                mode={mode}
              />
            </div>
          </div>

          <div className="side">
            <div className="stack">
              <WeightPanel analysis={analysis} />
              <DayInspector
                detail={detail}
                selectedDate={selectedDate}
                windows={windows}
                dates={dates}
                onSelectDate={setSelectedDate}
                study={study}
                mode={mode}
                subjectName={subjectStore.name}
                status={statusAt(DATA, subjectId, selectedDate)}
              />
              <StabilityPanel analysis={analysis} />
            </div>
          </div>
        </div>

        <PlaceboPanel
          DATA={DATA}
          analysis={analysis}
          studyId={state.studyId}
          onPick={setPlaceboSubject}
          mode={mode}
        />

        <div className="card">
          <div className="card-head">
            <div className="card-head-main">
              <div className="eyebrow">阅读边界</div>
              <div className="card-title">在什么假设下，这些数字才值得看</div>
            </div>
          </div>
          <div className="assumptions">
            <div>
              <h3>可比性假设</h3>
              <ul>
                <li>活动开始前，分析对象与加权对照组合的共同波动结构，在活动后（没有活动时）保持不变。</li>
                <li>候选对照在观察窗内没有自己的活动、本地冲击或经营水平突变；有则被排除，不做“打补丁”校正。</li>
                <li>权重只用活动前、双方都有观测的日期估计。活动期与活动后的数据不进入权重选择。</li>
                <li>停业表示确认没营业，漏报表示数据缺失但可能营业：两者都会让当日不可比，但原因分开记录。</li>
              </ul>
            </div>
            <div>
              <h3>这些数字不说明什么</h3>
              <ul>
                <li>不识别真实因果效应，也不承诺无混杂。差距是“相对于合成对照的偏离”。</li>
                <li>不能外推到其他门店、其他档期或重复投放；样本只有一家活动店。</li>
                <li>无法替代随机对照试验或更强的识别设计；若对照本身受影响，差距会被污染。</li>
                <li>单日差距受噪声影响大，应看活动期与活动后窗口的合计，并结合稳定性检验。</li>
              </ul>
            </div>
          </div>
        </div>

        <footer className="footer">
          <span>虚构演示数据 · 生成于 2026-11-21 · 种子 {DATA.meta.seed}</span>
          <span>口径：门店每日营业交易额（元），剔除退款与线上到家订单</span>
          <span>拟合 {fit.ok ? fit.preMetric.n : 0} 天 · 窗口 {fmtDateFull(windows.preStart)} – {fmtDateFull(windows.postEnd)}</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setMethodOpen(true)}>查看完整方法</button>
        </footer>
      </main>

      <MethodDialog open={methodOpen} onClose={() => setMethodOpen(false)} analysis={analysis} />
    </div>
  );
}
