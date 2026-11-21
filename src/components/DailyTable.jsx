import React, { useState } from 'react';
import {
  fmtDateCN, fmtMoney, fmtSignedMoney, fmtSignedPct, weekdayCN,
} from '../engine/analysis.js';

/** 图表的表格孪生：所有数值都可以不依赖悬停读到。 */
export default function DailyTable({ fit, windows, selectedDate, onSelectDate }) {
  const [open, setOpen] = useState(false);
  if (!fit?.ok) return null;
  const byDate = new Map();
  for (const p of fit.preSeries) byDate.set(p.date, p);
  for (const p of fit.eventSeries) byDate.set(p.date, p);
  for (const p of fit.postSeries) byDate.set(p.date, p);
  const rows = windows.windowDates.map((d) => byDate.get(d) ?? { date: d, status: 'out' });

  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: open ? 12 : 0 }}>
        <div className="card-head-main">
          <div className="eyebrow">表格视图</div>
          <div className="card-title">逐日数值（图表的等价表格）</div>
          <div className="card-sub">与图表同一口径；不可比日会注明原因。</div>
        </div>
        <div className="card-actions">
          <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? '收起表格' : `展开 ${rows.length} 天`}
          </button>
        </div>
      </div>
      {open ? (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>阶段</th>
                  <th className="num">实际</th>
                  <th className="num">合成对照</th>
                  <th className="num">差距</th>
                  <th className="num">相对</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isEvent = r.date >= windows.eventStart && r.date <= windows.eventEnd;
                  const zone = isEvent ? '活动期' : r.date < windows.eventStart ? '活动前' : '活动后';
                  return (
                    <tr
                      key={r.date}
                      className={r.date === selectedDate ? 'is-selected' : ''}
                      onClick={() => onSelectDate(r.date)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="name">{fmtDateCN(r.date)} <span className="sub">{weekdayCN(r.date)}</span></td>
                      <td>{zone}</td>
                      {r.status === 'ok' ? (
                        <>
                          <td className="num">{fmtMoney(r.actual)}</td>
                          <td className="num">{fmtMoney(r.synthetic)}</td>
                          <td className="num" style={{ color: r.gap >= 0 ? 'var(--actual)' : 'var(--gap-neg)' }}>{fmtSignedMoney(r.gap)}</td>
                          <td className="num">{fmtSignedPct(r.gapPct)}</td>
                        </>
                      ) : (
                        <td colSpan={4} className="sub">
                          {r.status === 'subject-missing'
                            ? `不可比：分析对象${r.subjectStatus === 'closure' ? '停业' : r.subjectStatus === 'missing' ? '漏报' : '无观测'}`
                            : r.status === 'donor-missing'
                              ? `不可比：对照店${r.missingStatus === 'closure' ? '停业' : '漏报'}`
                              : '不在观察窗口'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-caption">点击任意行可同步到单日明细。</div>
        </>
      ) : null}
    </div>
  );
}
