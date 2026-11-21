/**
 * 精确的合成对照权重求解器。
 * 求解 min ||Xw - y||^2  s.t. w >= 0, sum(w) = 1（单纯形上的最小二乘）。
 *
 * 用主动集法：把“和为 1”作为等式约束写进 KKT 线性系统，迭代把变成负数的
 * 权重移出主动集、把 KKT 乘子为负的权重加回，直到 KKT 条件成立。
 * 候选店只有个位数，浏览器里可以毫秒级精确求解；比梯度投影稳定得多。
 */
export function solveSimplexExact(X, y) {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (!n || !p) return [];
  if (p === 1) return [1];

  // 按 y 的均值缩放，降低大额交易额带来的条件数问题（解对整体缩放不变）。
  const scale = y.reduce((a, b) => a + b, 0) / n || 1;
  const A = X.map((row) => row.map((v) => v / scale));
  const b = y.map((v) => v / scale);

  const G = Array.from({ length: p }, () => new Array(p).fill(0));
  const h = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      h[j] += A[i][j] * b[i];
      for (let k = j; k < p; k++) {
        const v = A[i][j] * A[i][k];
        G[j][k] += v;
        if (k !== j) G[k][j] += v;
      }
    }
  }

  const active = new Array(p).fill(true);
  let w = new Array(p).fill(0);
  for (let iteration = 0; iteration < 200; iteration++) {
    const idx = [];
    for (let j = 0; j < p; j++) if (active[j]) idx.push(j);
    const m = idx.length;

    let candidate = new Array(p).fill(0);
    if (m) {
      // KKT: [2G_A 1; 1' 0] [w_A; λ] = [2h_A; 1]
      const M = Array.from({ length: m + 1 }, () => new Array(m + 1).fill(0));
      const rhs = new Array(m + 1).fill(0);
      for (let a = 0; a < m; a++) {
        for (let c = 0; c < m; c++) M[a][c] = 2 * G[idx[a]][idx[c]];
        M[a][m] = 1;
        M[m][a] = 1;
        rhs[a] = 2 * h[idx[a]];
      }
      rhs[m] = 1;
      const sol = solveLinear(M, rhs);
      if (!sol) break;
      idx.forEach((j, a) => { candidate[j] = sol[a]; });
    }

    // 有负权重：最负的一个离开主动集。
    let worst = -1;
    for (const j of idx) {
      if (candidate[j] < -1e-11 && (worst < 0 || candidate[j] < candidate[worst])) worst = j;
    }
    if (worst >= 0) {
      active[worst] = false;
      continue;
    }
    w = candidate;

    // KKT 检查：非主动集上的梯度若为负，说明还有下降方向，重新加入。
    let added = false;
    for (let j = 0; j < p; j++) {
      if (active[j]) continue;
      let g = 0;
      for (let k = 0; k < p; k++) if (active[k]) g += G[j][k] * candidate[k];
      if (2 * (g - h[j]) < -1e-9) { active[j] = true; added = true; }
    }
    if (!added) break;
  }

  w = w.map((v) => (v < 1e-9 ? 0 : v));
  const total = w.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return w.map((_, j) => (j === 0 ? 1 : 0));
  return w.map((v) => v / total);
}

function solveLinear(M, rhs) {
  const n = M.length;
  const A = M.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    }
    if (Math.abs(A[pivot][col]) < 1e-12) return null;
    if (pivot !== col) { const t = A[pivot]; A[pivot] = A[col]; A[col] = t; }
    const pv = A[col][col];
    for (let c = col; c <= n; c++) A[col][c] /= pv;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = A[row][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) A[row][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row[n]);
}

/** 供测试对照：投影梯度法（近似解）。 */
export function solveSimplexProjected(X, y, { maxIter = 20000 } = {}) {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (!n || !p) return [];
  const scale = y.reduce((a, b) => a + b, 0) / n || 1;
  const A = X.map((row) => row.map((v) => v / scale));
  const b = y.map((v) => v / scale);
  let L = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) L += A[i][j] ** 2;
  const step = 1 / Math.max(L, 1e-9);
  let w = new Array(p).fill(1 / p);
  for (let iter = 0; iter < maxIter; iter++) {
    const grad = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += A[i][j] * w[j];
      const r = s - b[i];
      for (let j = 0; j < p; j++) grad[j] += 2 * r * A[i][j];
    }
    w = projectSimplex(w.map((v, j) => v - step * grad[j]));
  }
  w = w.map((v) => (v < 1e-7 ? 0 : v));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / total);
}

function projectSimplex(v) {
  const sorted = [...v].sort((a, b) => b - a);
  let css = 0;
  let theta = 0;
  for (let i = 0; i < sorted.length; i++) {
    css += sorted[i];
    const t = (css - 1) / (i + 1);
    if (sorted[i] - t > 0) theta = t;
  }
  return v.map((x) => Math.max(0, x - theta));
}
