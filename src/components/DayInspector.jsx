import React from 'react';
import {
  fmtDateCN, fmtMoney, fmtPct, fmtSignedMoney, fmtSignedPct, weekdayCN,
} from '../engine/analysis.js';
import { Chip, Icon } from './ui.jsx';

export default function DayInspector({
  detail, selectedDate, windows, dates, onSelectDate, study, mode, subjectName, status,
}) {
  const idx = dates.indexOf(selectedDate);
  const step = (n) => {
    const next = dates[Math.min(dates.length - 1, Math.max(0, idx + n))];
    if (next) onSelectDate(next);
  };

  const zoneLabel = selectedDate < study.start
    ? '活动前 · 拟合窗口'
    : selectedDate > study.end
      ? '活动后 · 单独观察'
      : '活动期间';

  const maxContribution = detail?.contributions?.reduce((a, c) => Math.max(a, c.contribution ?? 0), 0) ?? 0;

  return (
    <div className="card">
      <div className="inspector-head">
        <div>
          <div className="eyebrow">单日明细</div>
          <div>
            <span className="inspector-date">{fmtDateCN(selectedDate)}</span>
            <span className="inspector-weekday">{weekdayCN(selectedDate)}</span>
          </div>
        </div>
        <div className="day-pager">
          <button className="icon-btn" aria-label="前一天" onClick={() => step(-1)} disabled={idx <= 0}>
            <Icon name="arrowLeft" />
          </button>
          <button className="icon-btn" aria-label="后一天" onClick={() => step(1)} disabled={idx >= dates.length - 1}>
            <Icon name="arrowRight" />
          </button>
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Chip tone={selectedDate >= study.start && selectedDate <= study.end ? 'accent' : 'neutral'}>{zoneLabel}</Chip>
        <span className="muted small">{mode === 'placebo' ? '安慰剂中当作活动对象' : '分析对象'}：{subjectName}</span>
      </div>

      {status !== 'observed' ? (
        <div className="detail-note" style={{ marginTop: 12 }}>
          分析对象当日{status === 'closure' ? '停业' : status === 'missing' ? '漏报' : '不在观察范围'}，该日不参与任何计算。
        </div>
      ) : null}

      {detail && detail.actual != null ? (
        <>
          <div className="detail-grid">
            <div className="detail-cell">
              <div className="k">实际</div>
              <div className="v">{fmtMoney(detail.actual)}<small>元</small></div>
            </div>
            <div className="detail-cell">
              <div className="k">加权合成</div>
              <div className="v">{fmtMoney(detail.synthetic)}<small>元</small></div>
            </div>
            <div className="detail-cell">
              <div className="k">差距</div>
              <div className="v" style={{ color: detail.gap >= 0 ? 'var(--actual)' : 'var(--gap-neg)' }}>
                {fmtSignedMoney(detail.gap)}<small>元</small>
              </div>
            </div>
            <div className="detail-cell">
              <div className="k">相对合成</div>
              <div className="v" style={{ color: detail.gap >= 0 ? 'var(--actual)' : 'var(--gap-neg)' }}>
                {fmtSignedPct(detail.synthetic ? detail.gap / detail.synthetic : null)}
              </div>
            </div>
          </div>

          <div className="eyebrow" style={{ marginTop: 4 }}>加权明细 · Σ 权重 × 当日交易额</div>
          {detail.contributions.length ? (
            <ul className="contrib">
              {detail.contributions.map((c) => (
                <li key={c.id}>
                  <div className="contrib-row">
                    <span className="contrib-name">
                      {c.name}
                      <span className="contrib-weight">× {fmtPct(c.weight, 1)}</span>
                    </span>
                    <span className="contrib-val">
                      {c.value == null ? <span className="muted">缺数</span> : fmtMoney(c.contribution)}
                    </span>
                  </div>
                  <div className="contrib-bar">
                    <span style={{ width: `${maxContribution > 0 ? (c.contribution / maxContribution) * 100 : 0}%` }} />
                  </div>
                </li>
              ))}
              <li className="contrib-total">
                <span>合成合计</span>
                <span className="tnum">{fmtMoney(detail.synthetic)}</span>
              </li>
            </ul>
          ) : (
            <div className="detail-note">当日没有正权重对照的观测，无法计算合成值。</div>
          )}
        </>
      ) : (
        <div className="detail-note" style={{ marginTop: 12 }}>
          {detail?.subjectStatus === 'closure'
            ? '分析对象当日停业。'
            : detail?.subjectStatus === 'missing'
              ? '分析对象当日漏报，无法核对。'
              : '该日不在观察窗口内。'}
        </div>
      )}

      <div className="table-caption" style={{ marginTop: 12 }}>
        停业 = 确认未营业；漏报 = 应有数据但缺失。两者都会让当日不可比，但成因不同。
      </div>
    </div>
  );
}
