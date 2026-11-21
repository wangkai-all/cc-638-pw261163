import React, { useMemo, useState } from 'react';
import {
  fmtDateCN, fmtPct, fmtSignedPct, statusAt,
} from '../engine/analysis.js';
import { Chip, Icon } from './ui.jsx';

const RULES = [
  { key: 'activity', label: '窗口内无活动', test: (d) => d.activities.length === 0 },
  { key: 'events', label: '无本地冲击 / 水平突变', test: (d) => d.localEvents.length === 0 && d.shifts.length === 0 },
  { key: 'coverage', label: '前后覆盖 ≥ 90%', test: (d) => d.coveragePre >= 0.9 && d.coveragePost >= 0.9 && d.preObserved >= 14 && d.postObserved >= 14 },
  { key: 'runs', label: '连续停业/漏报 ≤ 7 天', test: (d) => !(d.closureRun?.length > 7) && !(d.missingRun?.length > 7) },
];

function coverageCell(d) {
  return (
    <span className="tnum">
      {Math.round(d.coveragePre * 100)}% / {Math.round(d.coveragePost * 100)}%
    </span>
  );
}

export default function CandidateTable({ analysis, excluded, locked, onToggleExclude, onLock, mode }) {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('id');
  const [expanded, setExpanded] = useState(null);
  const [showReasons, setShowReasons] = useState(true);

  const rows = useMemo(() => {
    const base = analysis.diagnoses.filter((d) => {
      if (d.isSubject) return false;
      if (filter === 'eligible') return d.eligible && !excluded.includes(d.id);
      if (filter === 'excluded') return d.eligible && excluded.includes(d.id);
      if (filter === 'ineligible') return !d.eligible;
      return true;
    });
    const weightOf = (id) => analysis.current.weights[id] ?? 0;
    const sorted = [...base];
    if (sort === 'weight') sorted.sort((a, b) => weightOf(b.id) - weightOf(a.id));
    else if (sort === 'coverage') sorted.sort((a, b) => b.coveragePre - a.coveragePre);
    else sorted.sort((a, b) => (a.id < b.id ? -1 : 1));
    return sorted;
  }, [analysis, excluded, filter, sort]);

  const multilineReasons = (d) => (
    <ul className="reasons">
      {d.reasons.map((r) => <li key={r}>{r}</li>)}
    </ul>
  );

  return (
    <>
      <div className="card-head">
        <div className="card-head-main">
          <div className="eyebrow">候选对照</div>
          <div className="card-title">候选资格 · 权重 · 锁定</div>
          <div className="card-sub">
            资格规则对所有分析（拟合、候选、安慰剂）完全一致：只要窗口内被其他事件污染或看不清，就不进入权重。
          </div>
        </div>
        <div className="card-actions">
          <button className="btn btn-sm" onClick={() => setShowReasons((v) => !v)}>
            {showReasons ? '隐藏排除原因' : '显示排除原因'}
          </button>
        </div>
      </div>

      <div className="filters">
        <div className="seg" role="group" aria-label="候选筛选">
          {[
            ['all', '全部'],
            ['eligible', '有资格'],
            ['excluded', '已排除'],
            ['ineligible', '不符合资格'],
          ].map(([k, label]) => (
            <button key={k} className="seg-btn" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <span className="field-label" style={{ margin: 0 }}>排序</span>
          <select className="select" style={{ minWidth: 130, height: 32 }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="id">门店编号</option>
            <option value="weight">当前权重</option>
            <option value="coverage">活动前覆盖</option>
          </select>
        </label>
        <span className="spacer" />
        <div className="result-line">
          <span>有资格 <strong className="tnum">{analysis.eligible.length}</strong> 家</span>
          <span>可用 <strong className="tnum">{analysis.eligible.filter((id) => !excluded.includes(id)).length}</strong> 家</span>
          <span>排除 <strong className="tnum">{excluded.length}</strong> 家</span>
          <span>锁定 <strong className="tnum">{Object.keys(locked).length}</strong> 家</span>
        </div>
      </div>

      <div className="scroll-hint">表格可横向滑动查看全部列</div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>门店</th>
              <th>资格</th>
              <th className="num">前置/后置覆盖</th>
              <th className="num">停业 / 漏报</th>
              <th className="num">当前权重</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const isExcluded = excluded.includes(d.id);
              const isLocked = Boolean(locked[d.id]);
              const weight = analysis.current.weights[d.id] ?? 0;
              const canUse = d.eligible;
              const isOpen = expanded === d.id;
              return (
                <React.Fragment key={d.id}>
                  <tr className={`${isExcluded ? 'row-excluded' : ''}`}>
                    <td>
                      <div className="name">{d.name}</div>
                      <div className="sub">
                        {d.id} · {d.district} · {d.format}
                      </div>
                      {!d.eligible && d.reasons.length ? (
                        <div className="sub" style={{ maxWidth: 320 }} title={d.reasons.join('；')}>
                          {d.reasons[0]}
                          {d.reasons.length > 1 ? ` 等 ${d.reasons.length} 项` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {d.eligible && !isExcluded ? <Chip tone="good" icon="check">有资格</Chip>
                        : d.eligible && isExcluded ? <Chip tone="warn" icon="x">手动排除</Chip>
                        : <Chip tone="bad" icon="x">不符合</Chip>}
                    </td>
                    <td className="num">{coverageCell(d)}</td>
                    <td className="num">{d.closureDays} / {d.missingDays}</td>
                    <td className="num">
                      {canUse && !isExcluded ? (
                        isLocked ? <span title="已锁定">{fmtPct(locked[d.id], 0)} <Icon name="lock" size={11} /></span> : fmtPct(weight, 1)
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="action-row">
                        {canUse ? (
                          <>
                            <button
                              className={`btn btn-sm ${isExcluded ? 'btn-primary' : 'btn-danger'}`}
                              onClick={() => onToggleExclude(d.id)}
                              title={isExcluded ? '恢复到候选集' : '从候选中排除'}
                            >
                              {isExcluded ? '恢复' : '排除'}
                            </button>
                            {!isExcluded ? (
                              isLocked ? (
                                <button className="btn btn-sm" onClick={() => onLock(d.id, null)} title="解除锁定">
                                  解除锁定
                                </button>
                              ) : (
                                <label className="action-row" title="锁定权重后，其余门店按剩余质量重新拟合">
                                  <Icon name="lock" size={12} />
                                  <input
                                    className="weight-input"
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="1"
                                    placeholder="%"
                                    aria-label={`锁定 ${d.name} 的权重（百分比）`}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        const v = Number(e.currentTarget.value);
                                        if (Number.isFinite(v) && v > 0) onLock(d.id, Math.min(100, v) / 100);
                                        e.currentTarget.value = '';
                                      }
                                    }}
                                  />
                                </label>
                              )
                            ) : null}
                          </>
                        ) : (
                          <button className="btn btn-sm btn-ghost" onClick={() => setExpanded(isOpen ? null : d.id)}>
                            {isOpen ? '收起' : '原因'}
                          </button>
                        )}
                        {d.eligible && showReasons && d.reasons.length ? (
                          <span className="sub">{d.reasons.length} 条提示</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {(!d.eligible && isOpen) || (d.eligible && showReasons && isExcluded) ? (
                    <tr>
                      <td colSpan={6} style={{ paddingTop: 0 }}>
                        {!d.eligible ? multilineReasons(d) : <div className="sub">已手动排除；不受资格规则影响，可随时恢复。</div>}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-caption">
        “前置/后置覆盖” = 活动前 56 天与活动后 56 天中有观测的比例。“停业 / 漏报”为窗口内天数，两者分开统计。
        连续超过 7 天的停业或漏报会让对照失去资格；单日缺失只在当日不可比，不影响整店资格。
      </div>
    </>
  );
}
