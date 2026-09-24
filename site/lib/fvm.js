// 2D incompressible Navier–Stokes, finite volume on a staggered (MAC) grid.
// Explicit conservative convection + diffusion, then a pressure projection solved by
// conjugate gradients. Dependency-free ES module (browser + Node).
//
// Layout for an N×N cell cavity of side 1 (h = 1/N):
//   u[i][j]  i = 0..N,   j = 0..N+1  x = i·h,        y = (j − ½)·h   (j = 0, N+1 ghosts)
//   v[i][j]  i = 0..N+1, j = 0..N    x = (i − ½)·h,  y = j·h         (i = 0, N+1 ghosts)
//   p[i][j]  i = 1..N,   j = 1..N    cell centres, stored densely as p[(j−1)·N + (i−1)]

export class CavityFVM {
  constructor({ n = 32, re = 100, uLid = 1, dt } = {}) {
    this.n = n;
    this.re = re;
    this.uLid = uLid;
    this.h = 1 / n;
    this.nu = uLid / re;
    const h = this.h;
    // Stable explicit step: diffusion and convective (CFL) limits with margin.
    this.dt = dt ?? 0.5 * Math.min((h * h) / (4 * this.nu), h / uLid, (2 * this.nu) / (uLid * uLid));
    this.u = new Float64Array((n + 1) * (n + 2));
    this.v = new Float64Array((n + 2) * (n + 1));
    this.us = new Float64Array(this.u.length);
    this.vs = new Float64Array(this.v.length);
    this.p = new Float64Array(n * n);
    this.rhs = new Float64Array(n * n);
    this._r = new Float64Array(n * n);
    this._d = new Float64Array(n * n);
    this._q = new Float64Array(n * n);
    this.time = 0;
    this.steps = 0;
    this.lastCgIters = 0;
    this.lastChange = Infinity;
    this.applyBC(this.u, this.v);
  }

  // Index helpers
  iu(i, j) { return i * (this.n + 2) + j; }
  iv(i, j) { return i * (this.n + 1) + j; }

  applyBC(u, v) {
    const n = this.n;
    for (let j = 0; j <= n + 1; j++) { u[this.iu(0, j)] = 0; u[this.iu(n, j)] = 0; }
    for (let i = 0; i <= n; i++) {
      u[this.iu(i, 0)] = -u[this.iu(i, 1)];
      u[this.iu(i, n + 1)] = 2 * this.uLid - u[this.iu(i, n)];
    }
    for (let i = 0; i <= n + 1; i++) { v[this.iv(i, 0)] = 0; v[this.iv(i, n)] = 0; }
    for (let j = 0; j <= n; j++) {
      v[this.iv(0, j)] = -v[this.iv(1, j)];
      v[this.iv(n + 1, j)] = -v[this.iv(n, j)];
    }
  }

  // Predictor: u* = u + dt·(−∇·(uu) + ν∇²u), face fluxes built from interpolated face values.
  predict() {
    const { n, h, dt, nu, u, v, us, vs } = this;
    const iu = (i, j) => i * (n + 2) + j;
    const iv = (i, j) => i * (n + 1) + j;
    const ih = 1 / h, ih2 = 1 / (h * h);
    us.set(u);
    vs.set(v);
    for (let i = 1; i < n; i++)
      for (let j = 1; j <= n; j++) {
        const uc = u[iu(i, j)];
        const ue = 0.5 * (uc + u[iu(i + 1, j)]);
        const uw = 0.5 * (u[iu(i - 1, j)] + uc);
        const un = 0.5 * (uc + u[iu(i, j + 1)]);
        const usb = 0.5 * (u[iu(i, j - 1)] + uc);
        const vn = 0.5 * (v[iv(i, j)] + v[iv(i + 1, j)]);
        const vsb = 0.5 * (v[iv(i, j - 1)] + v[iv(i + 1, j - 1)]);
        const conv = (ue * ue - uw * uw) * ih + (un * vn - usb * vsb) * ih;
        const diff = nu * (u[iu(i + 1, j)] + u[iu(i - 1, j)] + u[iu(i, j + 1)] + u[iu(i, j - 1)] - 4 * uc) * ih2;
        us[iu(i, j)] = uc + dt * (diff - conv);
      }
    for (let i = 1; i <= n; i++)
      for (let j = 1; j < n; j++) {
        const vc = v[iv(i, j)];
        const vn = 0.5 * (vc + v[iv(i, j + 1)]);
        const vsb = 0.5 * (v[iv(i, j - 1)] + vc);
        const ve = 0.5 * (vc + v[iv(i + 1, j)]);
        const vw = 0.5 * (v[iv(i - 1, j)] + vc);
        const ue = 0.5 * (u[iu(i, j)] + u[iu(i, j + 1)]);
        const uw = 0.5 * (u[iu(i - 1, j)] + u[iu(i - 1, j + 1)]);
        const conv = (vn * vn - vsb * vsb) * ih + (ue * ve - uw * vw) * ih;
        const diff = nu * (v[iv(i + 1, j)] + v[iv(i - 1, j)] + v[iv(i, j + 1)] + v[iv(i, j - 1)] - 4 * vc) * ih2;
        vs[iv(i, j)] = vc + dt * (diff - conv);
      }
    this.applyBC(us, vs);
  }

  // Negative Neumann Laplacian (symmetric positive semi-definite), scaled by h².
  applyA(x, out) {
    const n = this.n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        let s = 0, c = 0;
        if (i > 0) { s += x[k - 1]; c++; }
        if (i < n - 1) { s += x[k + 1]; c++; }
        if (j > 0) { s += x[k - n]; c++; }
        if (j < n - 1) { s += x[k + n]; c++; }
        out[k] = c * x[k] - s;
      }
  }

  // Solve A p = b with CG (warm-started from the previous pressure).
  solvePressure(tol = 1e-8, maxIter = 2000) {
    const { n, p, rhs } = this;
    const N = n * n;
    const r = this._r, d = this._d, q = this._q;
    let mean = 0;
    for (let k = 0; k < N; k++) mean += rhs[k];
    mean /= N;
    for (let k = 0; k < N; k++) rhs[k] -= mean;
    this.applyA(p, q);
    let rr = 0, bb = 0;
    for (let k = 0; k < N; k++) { r[k] = rhs[k] - q[k]; d[k] = r[k]; rr += r[k] * r[k]; bb += rhs[k] * rhs[k]; }
    const stop = tol * tol * Math.max(bb, 1e-300);
    let it = 0;
    while (rr > stop && it < maxIter) {
      this.applyA(d, q);
      let dq = 0;
      for (let k = 0; k < N; k++) dq += d[k] * q[k];
      const alpha = rr / dq;
      let rrNew = 0;
      for (let k = 0; k < N; k++) { p[k] += alpha * d[k]; r[k] -= alpha * q[k]; rrNew += r[k] * r[k]; }
      const beta = rrNew / rr;
      for (let k = 0; k < N; k++) d[k] = r[k] + beta * d[k];
      rr = rrNew;
      it++;
    }
    this.lastCgIters = it;
  }

  project() {
    const { n, h, dt, us, vs, p, rhs } = this;
    const iu = (i, j) => i * (n + 2) + j;
    const iv = (i, j) => i * (n + 1) + j;
    // A(p) = −h²∇²p  and  ∇²p = div(u*)/dt  ⇒  A(p) = −h·(net outflux)/dt
    for (let j = 1; j <= n; j++)
      for (let i = 1; i <= n; i++) {
        const div = us[iu(i, j)] - us[iu(i - 1, j)] + vs[iv(i, j)] - vs[iv(i, j - 1)];
        rhs[(j - 1) * n + (i - 1)] = (-h * div) / dt;
      }
    this.solvePressure();
    const c = dt / h;
    let change = 0;
    const { u, v } = this;
    for (let i = 1; i < n; i++)
      for (let j = 1; j <= n; j++) {
        const nu_ = us[iu(i, j)] - c * (p[(j - 1) * n + i] - p[(j - 1) * n + i - 1]);
        change = Math.max(change, Math.abs(nu_ - u[iu(i, j)]));
        u[iu(i, j)] = nu_;
      }
    for (let i = 1; i <= n; i++)
      for (let j = 1; j < n; j++) {
        const nv = vs[iv(i, j)] - c * (p[j * n + i - 1] - p[(j - 1) * n + i - 1]);
        change = Math.max(change, Math.abs(nv - v[iv(i, j)]));
        v[iv(i, j)] = nv;
      }
    this.applyBC(u, v);
    this.lastChange = change / dt;
  }

  step(count = 1) {
    for (let s = 0; s < count; s++) {
      this.predict();
      this.project();
      this.time += this.dt;
      this.steps++;
    }
    return this;
  }

  // Run until the max velocity rate of change falls below tol (or maxTime).
  solveSteady({ tol = 1e-5, maxTime = 60 } = {}) {
    while (this.time < maxTime) {
      this.step();
      if (this.lastChange < tol) break;
    }
    return this;
  }

  maxDivergence() {
    const { n, h, u, v } = this;
    let m = 0;
    for (let j = 1; j <= n; j++)
      for (let i = 1; i <= n; i++) {
        const d = (u[this.iu(i, j)] - u[this.iu(i - 1, j)] + v[this.iv(i, j)] - v[this.iv(i, j - 1)]) / h;
        m = Math.max(m, Math.abs(d));
      }
    return m;
  }

  // u(y) along the vertical centreline x = ½, normalised by the lid speed.
  centerlineU() {
    const n = this.n;
    const out = [{ y: 0, u: 0 }];
    const i = n / 2;
    for (let j = 1; j <= n; j++) {
      const val = Number.isInteger(i)
        ? this.u[this.iu(i, j)]
        : 0.5 * (this.u[this.iu(Math.floor(i), j)] + this.u[this.iu(Math.ceil(i), j)]);
      out.push({ y: (j - 0.5) * this.h, u: val / this.uLid });
    }
    out.push({ y: 1, u: 1 });
    return out;
  }

  // v(x) along the horizontal centreline y = ½, normalised by the lid speed.
  centerlineV() {
    const n = this.n;
    const out = [{ x: 0, v: 0 }];
    const j = n / 2;
    for (let i = 1; i <= n; i++) {
      const val = Number.isInteger(j)
        ? this.v[this.iv(i, j)]
        : 0.5 * (this.v[this.iv(i, Math.floor(j))] + this.v[this.iv(i, Math.ceil(j))]);
      out.push({ x: (i - 0.5) * this.h, v: val / this.uLid });
    }
    out.push({ x: 1, v: 0 });
    return out;
  }

  // Cell-centred speed field (row-major, j = 0 at the bottom) for rendering.
  speedField(out = new Float64Array(this.n * this.n)) {
    const n = this.n;
    for (let j = 1; j <= n; j++)
      for (let i = 1; i <= n; i++) {
        const uc = 0.5 * (this.u[this.iu(i - 1, j)] + this.u[this.iu(i, j)]);
        const vc = 0.5 * (this.v[this.iv(i, j - 1)] + this.v[this.iv(i, j)]);
        out[(j - 1) * n + (i - 1)] = Math.hypot(uc, vc) / this.uLid;
      }
    return out;
  }
}
