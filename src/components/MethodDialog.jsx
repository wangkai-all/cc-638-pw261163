import React, { useEffect } from 'react';
import { fmtDateCN, fmtPct, fmtSignedPct } from '../engine/analysis.js';

export default function MethodDialog({ open, onClose, analysis }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const { windows, current } = analysis;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="method-title">
        <div className="dialog-head">
          <div>
            <h2 id="method-title">方法与口径</h2>
            <div className="muted small">合成对照（synthetic control）式比较 · 虚构演示</div>
          </div>
          <button className="btn dialog-close" onClick={onClose}>关闭</button>
        </div>

        <h3>1. 数据口径</h3>
        <p>
          指标是门店每日营业交易额（元），剔除退款与线上到家订单。每个门店每天只有三种状态：
          <code>observed</code>（有观测）、<code>closure</code>（停业，确认没营业）、<code>missing</code>（漏报，缺数据但可能营业）。
          停业与漏报分开记录，且在候选资格与单日可比性上分别处理。
        </p>

        <h3>2. 窗口</h3>
        <p>
          本次分析：活动前 {windows.preDays} 天（{fmtDateCN(windows.preStart)}–{fmtDateCN(windows.preEnd)}），
          活动期 {fmtDateCN(windows.eventStart)}–{fmtDateCN(windows.eventEnd)}，
          活动后 {windows.postDays} 天（{fmtDateCN(windows.postStart)}–{fmtDateCN(windows.postEnd)}）。
          活动后窗口从活动结束次日开始，与活动期严格不重叠，长度固定为 {windows.postDays} 天。
        </p>

        <h3>3. 权重怎么来</h3>
        <p>
          对每个候选对照店给一个非负权重 <code>w_j</code>，满足 <code>Σ w_j = 1</code>，最小化活动前分析对象与其加权组合的平方误差：
          <code>min ‖ y − Xw ‖²</code>。只在“分析对象与所有候选对照当日都有观测”的活动前日期上拟合。
          活动期和活动后的数据只用于画差距，绝不参与选权重。求解用主动集法精确解，锁定的权重固定，其余质量在剩余候选中重新分配。
        </p>

        <h3>4. 谁有资格当对照</h3>
        <ul>
          <li>观察窗口内没有自己的活动（推广或另一场活动）。</li>
          <li>观察窗口内没有本地冲击或经营水平突变（装修、道路施工、重新开业等）。</li>
          <li>活动前、活动后两个观察期的观测覆盖率均不低于 90%，且各有至少 14 天观测。</li>
          <li>窗口内连续停业或连续漏报均不超过 7 天；单日缺失只让当日不可比，不影响整店资格。</li>
        </ul>
        <p>
          这些规则只依据“是否被处理 + 是否看得清”，不看活动后的结果，避免用结果挑选对照。不满足的门店会在候选表中逐条说明原因。
          拟合、候选资格和安慰剂使用完全相同的规则和窗口。
        </p>

        <h3>5. 怎么读结果</h3>
        <ul>
          <li><strong>活动期差距</strong>：活动期间逐日（实际 − 合成）之和，除以合成值。活动长度很短时，单日噪声占比高。</li>
          <li><strong>活动后差距</strong>：活动结束后的独立观察窗，检查是否有持续变化。它和活动期都不参与权重。</li>
          <li><strong>活动前拟合</strong>：共同观测日的 MAPE 与 R²。拟合很差时，活动后差距不可解释。</li>
          <li><strong>稳定性</strong>：逐一排除正权重候选并重新拟合。方向翻转或幅度大幅变化，说明结论依赖具体对照组合。</li>
          <li><strong>安慰剂</strong>：把无活动的门店轮流当作活动对象。若它们也报出明显“效应”，说明方法在当前数据上分辨不出活动与噪声。</li>
        </ul>

        <h3>6. 不承诺什么</h3>
        <p>
          差距是“相对于合成对照的偏离”，不是因果效应。解释依赖一条强假设：
          没有活动时，分析对象与加权对照组合的共同波动结构在活动后保持不变。若对照店被同一活动影响、或存在未观测的共同冲击，差距会被污染。
          本页不识别真实因果，也不能外推到其他档期或门店。
        </p>

        <div className="hr" />
        <div className="muted small">
          当前：{fmtDateCN(windows.preStart)}–{fmtDateCN(windows.postEnd)} · 拟合日 {current?.preMetric?.n ?? 0} 天 ·
          当前 MAPE {current?.ok ? fmtPct(current.preMetric.mape) : '—'} ·
          活动后差距 {current?.ok ? fmtSignedPct(current.post.relativeGap) : '—'}
        </div>
      </div>
    </div>
  );
}
