import React, { useEffect, useRef, useState } from 'react';
import {
  fmtDateCN, fmtDateShort, fmtMoney, fmtSignedMoney, fmtSignedPct,
  weekdayCN,
} from '../engine/analysis.js';

const M = { top: 20, right: 58, bottom: 30, left: 54 };
const H = 232;

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!ref.current) return undefined;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(Math.max(320, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function niceTicks(lo, hi, count = 4) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

export const compact = (v) => {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(abs >= 100000 ? 0 : 1)}万`;
  if (abs >= 1000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
};

function ChartTip({ x, y, containerWidth, children }) {
  const TIP_W = 224;
  const left = Math.min(containerWidth - TIP_W - 4, Math.max(4, x + 14));
  return <div className="chart-tip" style={{ left, top: y + 6, width: TIP_W }}>{children}</div>;
}

function usePointer(dates, xOf, svgRef, width, onSelectDate, setHover) {
  return (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = ((e.clientX - rect.left) / rect.width) * width;
    const t = (rel - M.left) / Math.max(1, width - M.left - M.right);
    const i = Math.round(Math.min(1, Math.max(0, t)) * (dates.length - 1));
    setHover(i);
    onSelectDate(dates[i]);
  };
}

function onKeyStep(e, dates, hoverIndex, selectedDate, setHover, onSelectDate) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const cur = hoverIndex ?? dates.indexOf(selectedDate);
  const next = Math.min(dates.length - 1, Math.max(0, cur + (e.key === 'ArrowLeft' ? -1 : 1)));
  setHover(next);
  onSelectDate(dates[next]);
}

/** 实际 vs 合成：折线 + 活动期阴影 + 日期选择。 */
export function LevelChart({ dates, fit, windows, subjectId, selectedDate, onSelectDate }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const data = React.useMemo(() => {
    if (!fit?.ok) return [];
    const byDate = new Map();
    for (const p of fit.preSeries) byDate.set(p.date, p);
    for (const p of fit.eventSeries) byDate.set(p.date, p);
    for (const p of fit.postSeries) byDate.set(p.date, p);
    return dates.map((d) => byDate.get(d) ?? { date: d, status: 'out' });
  }, [dates, fit]);

  const vals = [];
  for (const d of data) if (d.status === 'ok') vals.push(d.actual, d.synthetic);
  const lo = (vals.length ? Math.min(...vals) : 0) * 0.94;
  const hi = (vals.length ? Math.max(...vals) : 1) * 1.06;
  const yTicks = niceTicks(lo, hi, 4);
  const yMin = Math.min(lo, yTicks[0] ?? lo);
  const yMax = Math.max(hi, yTicks.at(-1) ?? hi);
  const x = (i) => M.left + (dates.length <= 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  const y = (v) => M.top + plotH - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;
  const idxOf = (d) => dates.indexOf(d);

  const eventX0 = x(Math.max(0, idxOf(windows.eventStart)));
  const eventX1 = x(Math.max(0, idxOf(windows.eventEnd)));
  const preEndX = x(Math.max(0, idxOf(windows.preEnd)));
  const postStartX = x(Math.max(0, idxOf(windows.postStart)));

  const pathFor = (key) => {
    let out = '';
    let pen = false;
    data.forEach((d, i) => {
      if (d.status !== 'ok') { pen = false; return; }
      out += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(d[key]).toFixed(2)}`;
      pen = true;
    });
    return out;
  };
  const areaPath = (() => {
    const segs = [];
    let cur = null;
    data.forEach((d, i) => {
      if (d.status !== 'ok') { if (cur) segs.push(cur); cur = null; return; }
      if (!cur) cur = [];
      cur.push(i);
    });
    if (cur) segs.push(cur);
    let p = '';
    for (const seg of segs) {
      if (seg.length < 2) continue;
      p += `M${x(seg[0])},${y(data[seg[0]].actual)}`;
      for (const i of seg.slice(1)) p += `L${x(i)},${y(data[i].actual)}`;
      for (const i of [...seg].reverse()) p += `L${x(i)},${y(data[i].synthetic)}`;
      p += 'Z';
    }
    return p;
  })();

  const tickEvery = Math.max(1, Math.ceil(dates.length / Math.max(3, Math.floor(plotW / 78))));
  const hoverIndex = hover != null ? hover : (selectedDate ? idxOf(selectedDate) : null);
  const detail = hoverIndex != null && hoverIndex >= 0 ? data[hoverIndex] : null;
  const lastOk = [...data].reverse().find((d) => d.status === 'ok');

  const move = usePointer(dates, x, svgRef, width, onSelectDate, setHover);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-head-main">
          <div className="eyebrow">走势</div>
          <div className="card-title">实际交易额 vs. 加权合成对照</div>
          <div className="card-sub">
            阴影为活动期（{fmtDateCN(windows.eventStart)}–{fmtDateCN(windows.eventEnd)}）。活动后的线只用于对照观察，不参与挑权重。
          </div>
        </div>
        <div className="card-actions">
          <div className="legend">
            <span className="legend-item"><i className="legend-swatch" style={{ background: 'var(--actual)' }} />实际</span>
            <span className="legend-item"><i className="legend-swatch" style={{ background: 'var(--synth)' }} />合成</span>
          </div>
        </div>
      </div>
      {!fit?.ok ? (
        <div className="chart-empty">{fit?.reason ?? '暂无可绘制的数据。'}</div>
      ) : (
        <>
          <div className="chart-frame" ref={ref}>
            <svg
              ref={svgRef}
              className="chart-svg"
              viewBox={`0 0 ${width} ${H}`}
              role="img"
              aria-label="实际交易额与合成对照的逐日折线图，可点击选择日期"
              onPointerMove={move}
              onPointerLeave={() => setHover(null)}
              tabIndex={0}
              onKeyDown={(e) => onKeyStep(e, dates, hoverIndex, selectedDate, setHover, onSelectDate)}
            >
              <rect x={M.left} y={M.top} width={plotW} height={plotH} fill="transparent" />
              <rect x={eventX0} y={M.top} width={Math.max(2, eventX1 - eventX0)} height={plotH} fill="var(--band)" />
              <line x1={preEndX} y1={M.top} x2={preEndX} y2={M.top + plotH} stroke="var(--border-strong)" strokeWidth="1" />
              <line x1={postStartX} y1={M.top} x2={postStartX} y2={M.top + plotH} stroke="var(--border-strong)" strokeWidth="1" />
              {width > 560 ? (
                <>
                  <text className="zone-label" x={M.left + 4} y={M.top - 7}>活动前 · 拟合</text>
                  <text className="zone-label strong" x={eventX0 + 6} y={M.top - 7}>活动期</text>
                  <text className="zone-label" x={postStartX + 6} y={M.top - 7}>活动后</text>
                </>
              ) : null}

              {yTicks.map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
                  <text className="axis-tick" x={M.left - 8} y={y(t) + 3.5} textAnchor="end">{compact(t)}</text>
                </g>
              ))}
              <line x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--axis)" strokeWidth="1" />
              {dates.map((d, i) => {
                const isLast = i === dates.length - 1;
                const crowded = !isLast && (dates.length - 1 - i) * (plotW / Math.max(1, dates.length - 1)) < 46;
                if ((i % tickEvery !== 0 && !isLast) || crowded) return null;
                return (
                  <text key={d} className="axis-tick" x={x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : isLast ? 'end' : 'middle'}>
                    {fmtDateShort(d)}
                  </text>
                );
              })}

              {areaPath ? <path d={areaPath} fill="var(--actual)" opacity="0.09" /> : null}
              <path className="line-synth" d={pathFor('synthetic')} stroke="var(--synth)" />
              <path className="line-actual" d={pathFor('actual')} stroke="var(--actual)" />
              {lastOk ? (
                <>
                  <circle cx={x(idxOf(lastOk.date))} cy={y(lastOk.actual)} r="4" fill="var(--actual)" className="mark-dot" />
                  <text className="axis-tick" x={x(idxOf(lastOk.date)) + 7} y={y(lastOk.actual) + 3.5} textAnchor="start" style={{ fill: 'var(--ink)', fontWeight: 600 }}>
                    {compact(lastOk.actual)}
                  </text>
                </>
              ) : null}

              {selectedDate && idxOf(selectedDate) >= 0 ? (
                <line x1={x(idxOf(selectedDate))} x2={x(idxOf(selectedDate))} y1={M.top} y2={M.top + plotH} stroke="var(--ink-2)" strokeWidth="1" opacity="0.55" />
              ) : null}
              {hover != null ? (
                <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} stroke="var(--muted)" strokeWidth="1" opacity="0.75" />
              ) : null}
              {hover != null && data[hover]?.status === 'ok' ? (
                <>
                  <circle cx={x(hover)} cy={y(data[hover].actual)} r="4.5" fill="var(--actual)" className="mark-dot" />
                  <circle cx={x(hover)} cy={y(data[hover].synthetic)} r="4.5" fill="var(--synth)" className="mark-dot" />
                </>
              ) : null}
            </svg>
            {hover != null && detail ? (
              <ChartTip x={x(hover)} y={M.top} containerWidth={width}>
                <div className="tip-date">{fmtDateCN(detail.date)}<span>{weekdayCN(detail.date)}</span></div>
                {detail.status === 'ok' ? (
                  <>
                    <div className="tip-row"><span className="tip-key"><i style={{ background: 'var(--actual)' }} />实际</span><span className="tip-val">{fmtMoney(detail.actual)}</span></div>
                    <div className="tip-row"><span className="tip-key"><i style={{ background: 'var(--synth)' }} />合成对照</span><span className="tip-val">{fmtMoney(detail.synthetic)}</span></div>
                    <div className="tip-row"><span className="tip-key">差距</span><span className="tip-val">{fmtSignedMoney(detail.gap)}</span></div>
                    <div className="tip-note">{fmtSignedPct(detail.gapPct)} · 点击看加权明细</div>
                  </>
                ) : (
                  <div className="tip-note">
                    当日不可比：{detail.status === 'subject-missing'
                      ? `分析对象${detail.subjectStatus === 'closure' ? '停业' : '漏报'}`
                      : `对照店缺数（${detail.missingDonor ?? '权重店'} ${detail.missingStatus === 'closure' ? '停业' : '漏报'}）`}
                  </div>
                )}
              </ChartTip>
            ) : null}
          </div>
          <div className="chart-foot">
            <div className="legend">
              <span className="legend-item"><i className="legend-swatch" style={{ background: 'var(--actual)' }} />实际交易额</span>
              <span className="legend-item"><i className="legend-swatch" style={{ background: 'var(--synth)' }} />合成对照（加权）</span>
              <span className="legend-item"><i className="legend-swatch rect" style={{ background: 'var(--band)' }} />活动期</span>
            </div>
            <span className="spacer" />
            <span className="muted">点击或拖动选择日期 · 方向键逐日移动</span>
          </div>
        </>
      )}
    </div>
  );
}

/** 逐日差距：活动后单独画出。 */
export function GapChart({ dates, fit, windows, selectedDate, onSelectDate }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const gapByDate = React.useMemo(() => {
    const map = new Map();
    for (const p of fit.preSeries) map.set(p.date, p);
    for (const p of fit.eventSeries) map.set(p.date, p);
    for (const p of fit.postSeries) map.set(p.date, p);
    return map;
  }, [fit]);

  const finite = dates.map((d) => gapByDate.get(d)).filter((p) => p?.status === 'ok').map((p) => p.gap);
  const maxAbs = Math.max(1, ...finite.map((v) => Math.abs(v)));
  const yMax = maxAbs * 1.12;
  const x = (i) => M.left + (dates.length <= 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  const y = (v) => M.top + plotH - ((v + yMax) / (2 * yMax)) * plotH;
  const zeroY = y(0);
  const barW = Math.max(1.4, Math.min(9, plotW / Math.max(1, dates.length) - 1));
  const idxOf = (d) => dates.indexOf(d);
  const eventX0 = x(Math.max(0, idxOf(windows.eventStart)));
  const eventX1 = x(Math.max(0, idxOf(windows.eventEnd)));
  const postStartX = x(Math.max(0, idxOf(windows.postStart)));
  const ticks = niceTicks(-maxAbs, maxAbs, 4).filter((v) => Math.abs(v) <= yMax);
  const hoverIndex = hover != null ? hover : (selectedDate ? idxOf(selectedDate) : null);
  const every = Math.max(1, Math.ceil(dates.length / Math.max(3, Math.floor(plotW / 78))));
  const move = usePointer(dates, x, svgRef, width, onSelectDate, setHover);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-head-main">
          <div className="eyebrow">差距</div>
          <div className="card-title">逐日差距：实际 − 合成对照</div>
          <div className="card-sub">蓝色为高于对照，红色为低于。活动后的柱形独立观察，不回流影响权重。</div>
        </div>
        <div className="card-actions">
          {fit.post?.meanGap != null ? (
            <span className={`chip ${fit.post.meanGap >= 0 ? 'chip-accent' : 'chip-bad'}`}>
              活动后日均 {fmtSignedMoney(fit.post.meanGap)} 元
            </span>
          ) : null}
        </div>
      </div>
      <div className="chart-frame" ref={ref}>
        <svg
          ref={svgRef}
          className="chart-svg"
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          aria-label="逐日差距柱形图，可点击选择日期"
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          onKeyDown={(e) => onKeyStep(e, dates, hoverIndex, selectedDate, setHover, onSelectDate)}
        >
          <rect x={M.left} y={M.top} width={plotW} height={plotH} fill="transparent" />
          <rect x={eventX0} y={M.top} width={Math.max(2, eventX1 - eventX0)} height={plotH} fill="var(--band)" />
          {width > 560 ? (
            <>
              <text className="zone-label" x={M.left + 4} y={M.top - 7}>活动前 · 拟合残差</text>
              <text className="zone-label strong" x={eventX0 + 6} y={M.top - 7}>活动期</text>
              <text className="zone-label" x={postStartX + 6} y={M.top - 7}>活动后</text>
            </>
          ) : null}

          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth="1" />
              <text className="axis-tick" x={M.left - 8} y={y(t) + 3.5} textAnchor="end">{compact(t)}</text>
            </g>
          ))}
          {dates.map((d, i) => {
            const p = gapByDate.get(d);
            if (p?.status !== 'ok') return null;
            const isEvent = d >= windows.eventStart && d <= windows.eventEnd;
            return (
              <rect
                key={d}
                className="bar-gap"
                x={x(i) - barW / 2}
                y={p.gap >= 0 ? y(p.gap) : zeroY}
                width={barW}
                height={Math.max(1, Math.abs(y(p.gap) - zeroY))}
                rx={barW > 3 ? 1.5 : 0}
                fill={p.gap >= 0 ? 'var(--gap-pos)' : 'var(--gap-neg)'}
                opacity={isEvent ? 0.95 : 0.7}
              />
            );
          })}
          {selectedDate && idxOf(selectedDate) >= 0 ? (
            <line x1={x(idxOf(selectedDate))} x2={x(idxOf(selectedDate))} y1={M.top} y2={M.top + plotH} stroke="var(--ink-2)" strokeWidth="1" opacity="0.5" />
          ) : null}
          {dates.map((d, i) => {
            const isLast = i === dates.length - 1;
            const crowded = !isLast && (dates.length - 1 - i) * (plotW / Math.max(1, dates.length - 1)) < 46;
            if ((i % every !== 0 && !isLast) || crowded) return null;
            return (
              <text key={d} className="axis-tick" x={x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : isLast ? 'end' : 'middle'}>
                {fmtDateShort(d)}
              </text>
            );
          })}
          {hover != null && gapByDate.get(dates[hover])?.status === 'ok' ? (
            <circle cx={x(hover)} cy={y(gapByDate.get(dates[hover]).gap)} r="4" fill={gapByDate.get(dates[hover]).gap >= 0 ? 'var(--gap-pos)' : 'var(--gap-neg)'} className="mark-dot" />
          ) : null}
        </svg>
        {hover != null && gapByDate.get(dates[hover])?.status === 'ok' ? (() => {
          const p = gapByDate.get(dates[hover]);
          return (
            <ChartTip x={x(hover)} y={M.top} containerWidth={width}>
              <div className="tip-date">{fmtDateCN(p.date)}<span>{weekdayCN(p.date)}</span></div>
              <div className="tip-row"><span className="tip-key">差距</span><span className="tip-val">{fmtSignedMoney(p.gap)}</span></div>
              <div className="tip-row"><span className="tip-key">相对合成</span><span className="tip-val">{fmtSignedPct(p.gapPct)}</span></div>
              <div className="tip-note">实际 {fmtMoney(p.actual)} · 合成 {fmtMoney(p.synthetic)}</div>
            </ChartTip>
          );
        })() : null}
      </div>
      <div className="chart-foot">
        <div className="legend">
          <span className="legend-item"><i className="legend-swatch rect" style={{ background: 'var(--gap-pos)' }} />高于合成</span>
          <span className="legend-item"><i className="legend-swatch rect" style={{ background: 'var(--gap-neg)' }} />低于合成</span>
        </div>
        <span className="spacer" />
        <span className="muted">空白日 = 不可比日（任一侧停业或漏报）</span>
      </div>
    </div>
  );
}
