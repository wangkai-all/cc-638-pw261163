import React from 'react';
import { fmtPct } from '../engine/analysis.js';
import { Chip, Icon } from './ui.jsx';

export default function WeightPanel({ analysis }) {
  const fit = analysis.current;
  if (!fit.ok) {
    return (
      <div className="card">
        <div className="eyebrow">权重</div>
        <div className="card-title">合成对照权重</div>
        <div className="detail-note" style={{ marginTop: 10 }}>{fit.reason}</div>
      </div>
    );
  }
  const entries = Object.entries(fit.weights)
    .filter(([, w]) => w > 1e-6)
    .sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 1;
  const excludedSet = new Set(fit.excluded);
  const zeroEligible = fit.donorIds.filter((id) => !excludedSet.has(id) && fit.weights[id] <= 1e-6);
  const conc = fit.concentration;

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-head-main">
          <div className="eyebrow">权重</div>
          <div className="card-title">合成对照权重</div>
          <div className="card-sub">
            权重非负、和为一，只用活动前双方都有观测的 {fit.preMetric.n} 天拟合；活动期与活动后不参与。
          </div>
        </div>
      </div>

      <div className="weights">
        {entries.map(([id, w]) => {
          const lockedW = fit.locked[id];
          return (
            <div className={`weight-row ${lockedW ? 'locked' : ''}`} key={id}>
              <span className="weight-name" title={analysis.diagnoses.find((d) => d.id === id)?.name}>
                {lockedW ? <span className="lock"><Icon name="lock" size={11} /></span> : null}
                {analysis.diagnoses.find((d) => d.id === id)?.name ?? id}
              </span>
              <span className="weight-track">
                <span className="weight-fill" style={{ width: `${(w / max) * 100}%`, display: 'block' }} />
              </span>
              <span className="weight-val">{fmtPct(w, 1)}</span>
            </div>
          );
        })}
        {zeroEligible.length ? (
          <div className="weight-row zero">
            <span className="weight-name" title={zeroEligible.map((id) => analysis.diagnoses.find((d) => d.id === id)?.name).join('、')}>
              其余 {zeroEligible.length} 家
            </span>
            <span className="weight-track" />
            <span className="weight-val">0%</span>
          </div>
        ) : null}
      </div>

      <div className="hr" />
      <div className="eyebrow">集中度</div>
      <div className="sharebar" aria-hidden="true">
        {entries.map(([id, w]) => (
          <span
            key={id}
            style={{ width: `${w * 100}%`, background: w >= 0.35 ? 'var(--actual)' : `color-mix(in srgb, var(--actual) ${35 + w * 100}%, var(--surface-3))` }}
          />
        ))}
      </div>
      <div className="share-legend">
        {entries.slice(0, 4).map(([id, w]) => (
          <span key={id}>
            <i style={{ background: w >= 0.35 ? 'var(--actual)' : `color-mix(in srgb, var(--actual) ${35 + w * 100}%, var(--surface-3))` }} />
            {analysis.diagnoses.find((d) => d.id === id)?.name} {fmtPct(w, 0)}
          </span>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <Chip tone={conc.dominant ? 'warn' : 'good'} icon={conc.dominant ? 'alert' : 'check'}>
          {conc.dominant ? '权重集中在单店' : '权重较分散'}
        </Chip>
        <span className="muted small">
          有效对照 {conc.effectiveDonors.toFixed(1)} 家 · 最大权重 {fmtPct(conc.topWeight, 1)}
        </span>
      </div>
      {conc.dominant ? (
        <div className="detail-note" style={{ marginTop: 10 }}>
          {fmtPct(conc.topWeight, 1)} 的权重落在一家店上。合成对照几乎等价于单店比较，
          结论对这家店的选择很敏感——可先锁定它，观察其余门店如何分担。
        </div>
      ) : null}
      <div className="table-caption">
        权重由非负最小二乘精确求解（主动集法），求和恒为 1。锁定的权重会固定，其余质量在剩余候选中重新分配。
      </div>
    </div>
  );
}
