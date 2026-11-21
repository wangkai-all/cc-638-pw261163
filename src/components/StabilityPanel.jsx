import React from 'react';
import { fmtPct, fmtSignedPct } from '../engine/analysis.js';
import { Chip } from './ui.jsx';

export default function StabilityPanel({ analysis }) {
  const { variants, min, max, signStable, robust } = analysis.stability;
  const fit = analysis.current;
  if (!fit.ok) {
    return (
      <div className="card">
        <div className="eyebrow">稳定性</div>
        <div className="card-title">排除一家后结论是否稳定</div>
        <div className="detail-note" style={{ marginTop: 10 }}>{fit.reason}</div>
      </div>
    );
  }
  const gapPcts = variants.filter((v) => v.fit.ok).map((v) => v.fit.post.relativeGap);
  const lo = Math.min(0, ...gapPcts, -0.05);
  const hi = Math.max(0, ...gapPcts, 0.05);
  const span = hi - lo;
  const pos = (v) => `${((v - lo) / span) * 100}%`;
  const zeroPos = pos(0);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-head-main">
          <div className="eyebrow">稳定性</div>
          <div className="card-title">排除一家候选后，结论是否稳定</div>
          <div className="card-sub">每次完整重解权重，比较活动后合计差距。</div>
        </div>
      </div>
      {!variants.length ? (
        <div className="detail-note">当前设置下没有可比较的变体。</div>
      ) : (
        <>
          <div className="stab-range">
            <span>活动后差距</span>
            <span className="tnum">
              {min == null ? '—' : `${fmtSignedPct(min)} ～ ${fmtSignedPct(max)}`}
            </span>
          </div>
          <div className="stab-list">
            {variants.map((v) => {
              const gap = v.fit.post?.relativeGap;
              return (
                <div className={`stab-row ${v.isCurrent ? 'current' : ''}`} key={v.label}>
                  <span className="stab-label" title={v.note}>
                    {v.label}
                    {v.note ? <span className="muted" style={{ display: 'block', fontSize: 10.5, fontWeight: 400 }}>{v.note}</span> : null}
                  </span>
                  <span className="stab-track">
                    <span className="stab-zero" style={{ left: zeroPos }} />
                    {gap != null ? (
                      <span
                        className="stab-dot"
                        style={{ left: pos(gap), background: gap >= 0 ? 'var(--actual)' : 'var(--gap-neg)' }}
                        title={`${v.label}：${fmtSignedPct(gap)}`}
                      />
                    ) : null}
                  </span>
                  <span className="stab-val" style={{ color: gap >= 0 ? 'var(--actual)' : 'var(--gap-neg)' }}>
                    {gap == null ? '—' : fmtSignedPct(gap)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Chip tone={robust ? 'good' : 'warn'} icon={robust ? 'check' : 'alert'}>
              {robust ? '方向一致，幅度稳定' : signStable ? '方向一致，但幅度敏感' : '排除单店后方向会翻转'}
            </Chip>
            <span className="muted small">
              {variants.length - 1} 个“排除一家”变体
            </span>
          </div>
          {!robust ? (
            <div className="detail-note" style={{ marginTop: 10 }}>
              {signStable
                ? '方向没变，但排除某一家后幅度变化明显：结论依赖具体对照组合，不能当作稳健估计。'
                : '至少有一个变体把差距方向翻了过来。活动后的结论不能被当作稳定发现。'}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
