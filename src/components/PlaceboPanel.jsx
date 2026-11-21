import React, { useMemo } from 'react';
import { placeboScan } from '../engine/analysis.js';
import { fmtPct, fmtSignedPct } from '../engine/analysis.js';
import { Chip, Icon } from './ui.jsx';

export default function PlaceboPanel({ DATA, studyId, onPick, mode }) {
  const scan = useMemo(() => placeboScan(DATA, { studyId }), [DATA, studyId]);
  const { rows, worst, valid } = scan;
  const validRows = rows.filter((r) => r.fit?.ok && !r.hasActivity);
  const gaps = validRows.map((r) => r.postGap).filter((v) => v != null);
  const lo = Math.min(-0.05, ...gaps, 0.05);
  const hi = Math.max(0.05, ...gaps);
  const span = hi - lo;
  const pos = (v) => `${((v - lo) / span) * 100}%`;
  const zero = pos(0);

  const badRows = validRows.filter((r) => r.preMape > 0.12).sort((a, b) => b.preMape - a.preMape);
  const counter = worst;

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-head-main">
          <div className="eyebrow">安慰剂</div>
          <div className="card-title">把所有店轮流假装成活动对象，会报出什么</div>
          <div className="card-sub">
            窗口、资格规则与拟合口径完全相同。没有活动的门店，理论上的“效应”应围绕 0；偏离越大、活动前拟合越差，越说明这个比较本身不可信。
          </div>
        </div>
        <div className="card-actions">
          <Chip tone="neutral">{validRows.length} 家无活动门店参与</Chip>
        </div>
      </div>

      <div className="placebo-grid">
        <div>
          <div className="stab-range">
            <span>安慰剂活动后差距（实际 − 合成）</span>
            <span className="tnum">{fmtSignedPct(lo)} ～ {fmtSignedPct(hi)}</span>
          </div>
          <div className="stab-list" style={{ maxHeight: 360, overflow: 'auto', paddingRight: 4 }}>
            {rows.map((r) => {
              const usable = r.fit?.ok;
              const gap = r.postGap;
              const bad = usable && !r.hasActivity && r.preMape > 0.12;
              return (
                <div className="placebo-row" key={r.id}>
                  <span className={`placebo-name ${bad ? 'bad' : ''}`} title={r.hasActivity ? '该店窗口内有自己的活动，不能当作“无活动”反例' : ''}>
                    {r.name}
                    {r.hasActivity ? ' *' : ''}
                  </span>
                  <span className="placebo-track">
                    <span className="placebo-zero" style={{ left: zero }} />
                    {usable && gap != null ? (
                      <span
                        className={`placebo-dot ${bad ? 'bad' : ''} ${r.hasActivity ? 'act' : ''}`}
                        style={{ left: pos(gap) }}
                        title={`${r.name}：活动后差距 ${fmtSignedPct(gap)}`}
                      />
                    ) : null}
                  </span>
                  <span className="placebo-val">{gap == null ? '—' : fmtSignedPct(gap)}</span>
                  <span className="placebo-fit" title="活动前平均绝对百分比误差">{r.preMape == null ? '—' : fmtPct(r.preMape, 0)}</span>
                </div>
              );
            })}
          </div>
          <div className="chart-foot">
            <span>右列 = 活动前拟合误差（MAPE）。* 表示该店在窗口内有自己的活动，仅作参考。</span>
          </div>
        </div>

        <div className="stack">
          {counter && counter.fit?.ok ? (
            <div className="counter-card">
              <div className="counter-title"><Icon name="alert" size={15} /> 活动前拟合本来就很差的反例：{counter.name}</div>
              <div className="counter-metrics">
                <div>
                  <div className="k">活动前 MAPE</div>
                  <div className="v" style={{ color: 'var(--critical)' }}>{fmtPct(counter.preMape, 0)}</div>
                </div>
                <div>
                  <div className="k">活动前 R²</div>
                  <div className="v">{counter.preR2 == null ? '—' : counter.preR2.toFixed(2)}</div>
                </div>
                <div>
                  <div className="k">“活动后”差距</div>
                  <div className="v">{fmtSignedPct(counter.postGap, 0)}</div>
                </div>
              </div>
              <div className="counter-text">
                这家店根本没做活动，却被报出 {fmtSignedPct(counter.postGap, 0)} 的“活动后差距”，原因是活动前就没有可用的对照组合
                （{fmtPct(counter.preMape, 0)} 的平均误差）。同样的拟合误差如果出现在真实活动店上，任何“效应”都无法与模型失配区分。
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-sm" onClick={() => onPick(counter.id)}>
                  把它设为安慰剂对象，看完整计算
                </button>
                <span className="muted small">会同步更新权重、单日明细与稳定性</span>
              </div>
            </div>
          ) : null}

          <div className="detail-note" style={{ margin: 0 }}>
            <strong>怎么读：</strong>没有活动的门店出现系统性非零差距，说明共同波动没有被对照组合吸收，或权重把某家店当成了“替身”。
            当活动前拟合误差已经接近甚至超过“效应”，活动后的数字就不能当证据。
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>拟合很差的反例</div>
            {badRows.length ? (
              <div className="stack" style={{ gap: 6 }}>
                {badRows.slice(0, 4).map((r) => (
                  <div className="row" key={r.id} style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span>{r.name}</span>
                    <span className="row" style={{ gap: 10 }}>
                      <span className="muted">MAPE {fmtPct(r.preMape, 0)}</span>
                      <span className="tnum">{fmtSignedPct(r.postGap, 0)}</span>
                      <button className="btn btn-sm btn-ghost" onClick={() => onPick(r.id)}>设为安慰剂</button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted small">本次扫描里没有拟合很差的候选。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
