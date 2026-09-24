// D2Q9 lattice Boltzmann solver (BGK collision, Guo forcing, half-way bounce-back).
// Dependency-free ES module: runs in browsers and in Node.
//
// Boundary sides (left/right/bottom/top) accept:
//   { type: 'periodic' }            wrap to the opposite side (set on both sides of an axis)
//   { type: 'wall', u: [ux, uy] }   half-way bounce-back, optional moving-wall velocity
//   { type: 'inlet', u: [ux, uy] }  equilibrium velocity inlet; u may be a function (y) => [ux, uy]
//   { type: 'outlet' }              fixed-density (ρ = 1) outlet, velocity extrapolated from the neighbour

export const Q = 9;
export const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
export const EY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
export const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];

export function feq(k, rho, ux, uy) {
  const eu = EX[k] * ux + EY[k] * uy;
  return W[k] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * (ux * ux + uy * uy));
}

const PERIODIC = { type: 'periodic' };

export class LBM2D {
  constructor({ nx, ny, tau = 0.6, force = [0, 0], boundaries = {} }) {
    if (tau <= 0.5) throw new RangeError('tau must exceed 0.5 for positive viscosity');
    this.nx = nx;
    this.ny = ny;
    this.tau = tau;
    this.force = force;
    this.bc = {
      left: boundaries.left ?? PERIODIC,
      right: boundaries.right ?? PERIODIC,
      bottom: boundaries.bottom ?? PERIODIC,
      top: boundaries.top ?? PERIODIC,
    };
    const n = nx * ny;
    this.f = new Float64Array(Q * n);
    this.fNext = new Float64Array(Q * n);
    this.rho = new Float64Array(n).fill(1);
    this.ux = new Float64Array(n);
    this.uy = new Float64Array(n);
    this.solid = new Uint8Array(n);
    this.bodyForce = [0, 0];
    this.time = 0;
    this.init(1, 0, 0);
  }

  get viscosity() {
    return (this.tau - 0.5) / 3;
  }

  idx(x, y) {
    return y * this.nx + x;
  }

  init(rho, ux, uy) {
    const n = this.nx * this.ny;
    for (let i = 0; i < n; i++) {
      const [u, v] = typeof ux === 'function' ? ux(i % this.nx, (i / this.nx) | 0) : [ux, uy];
      this.rho[i] = rho;
      this.ux[i] = this.solid[i] ? 0 : u;
      this.uy[i] = this.solid[i] ? 0 : v;
      for (let k = 0; k < Q; k++) this.f[k * n + i] = feq(k, rho, this.ux[i], this.uy[i]);
    }
  }

  // Mark solid nodes with predicate (x, y) => boolean.
  setSolid(predicate) {
    for (let y = 0; y < this.ny; y++)
      for (let x = 0; x < this.nx; x++) this.solid[this.idx(x, y)] = predicate(x, y) ? 1 : 0;
  }

  addCylinder(cx, cy, r) {
    const prev = this.solid.slice();
    this.setSolid((x, y) => prev[this.idx(x, y)] || (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
  }

  // Collide in place, computing macroscopic moments (Guo forcing).
  collide() {
    const { nx, ny, f, rho, ux, uy, solid, tau } = this;
    const n = nx * ny;
    const [Fx, Fy] = this.force;
    const omega = 1 / tau;
    const forcePref = 1 - 0.5 * omega;
    const forced = Fx !== 0 || Fy !== 0;
    for (let i = 0; i < n; i++) {
      if (solid[i]) continue;
      let r = 0, mx = 0, my = 0;
      for (let k = 0; k < Q; k++) {
        const fk = f[k * n + i];
        r += fk;
        mx += fk * EX[k];
        my += fk * EY[k];
      }
      const u = (mx + 0.5 * Fx) / r;
      const v = (my + 0.5 * Fy) / r;
      rho[i] = r;
      ux[i] = u;
      uy[i] = v;
      const usq = 1.5 * (u * u + v * v);
      for (let k = 0; k < Q; k++) {
        const j = k * n + i;
        const eu = EX[k] * u + EY[k] * v;
        const eq = W[k] * r * (1 + 3 * eu + 4.5 * eu * eu - usq);
        let s = 0;
        if (forced) s = forcePref * W[k] * (3 * ((EX[k] - u) * Fx + (EY[k] - v) * Fy) + 9 * eu * (EX[k] * Fx + EY[k] * Fy));
        f[j] += omega * (eq - f[j]) + s;
      }
    }
  }

  // Pull-stream from f into fNext with boundary handling; accumulate obstacle force.
  stream() {
    const { nx, ny, f, fNext, solid, bc, rho } = this;
    const n = nx * ny;
    const xPer = bc.left.type === 'periodic';
    const yPer = bc.bottom.type === 'periodic';
    let bfx = 0, bfy = 0;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        if (solid[i]) continue;
        fNext[i] = f[i];
        if (x > 0 && x < nx - 1 && y > 0 && y < ny - 1) {
          // Interior fast path: no domain-edge handling needed.
          for (let k = 1; k < Q; k++) {
            const s = i - EY[k] * nx - EX[k];
            if (solid[s]) {
              const o = OPP[k];
              const fo = f[o * n + i];
              fNext[k * n + i] = fo;
              bfx += 2 * fo * EX[o];
              bfy += 2 * fo * EY[o];
            } else {
              fNext[k * n + i] = f[k * n + s];
            }
          }
          continue;
        }
        for (let k = 1; k < Q; k++) {
          let sx = x - EX[k];
          let sy = y - EY[k];
          let side = null;
          if (sx < 0) { if (xPer) sx += nx; else side = bc.left; }
          else if (sx >= nx) { if (xPer) sx -= nx; else side = bc.right; }
          if (sy < 0) { if (yPer) sy += ny; else side = bc.bottom; }
          else if (sy >= ny) { if (yPer) sy -= ny; else side = bc.top; }
          const o = OPP[k];
          if (side) {
            let val = f[o * n + i];
            if (side.type === 'wall' && side.u) val += 6 * W[k] * rho[i] * (EX[k] * side.u[0] + EY[k] * side.u[1]);
            fNext[k * n + i] = val;
            continue;
          }
          const s = sy * nx + sx;
          if (solid[s]) {
            const fo = f[o * n + i];
            fNext[k * n + i] = fo;
            bfx += 2 * fo * EX[o];
            bfy += 2 * fo * EY[o];
          } else {
            fNext[k * n + i] = f[k * n + s];
          }
        }
      }
    }
    this.bodyForce = [bfx, bfy];
    this.f = fNext;
    this.fNext = f;
  }

  applyOpenBoundaries() {
    const { nx, ny, f, bc } = this;
    const n = nx * ny;
    // Outlet at reference density 1: equilibrium with the neighbour's velocity plus the
    // neighbour's non-equilibrium part (non-equilibrium extrapolation).
    const pressureOutlet = (i, j) => {
      let r = 0, mx = 0, my = 0;
      for (let k = 0; k < Q; k++) {
        const fk = f[k * n + j];
        r += fk;
        mx += fk * EX[k];
        my += fk * EY[k];
      }
      const u = mx / r, v = my / r;
      for (let k = 0; k < Q; k++) f[k * n + i] = feq(k, 1, u, v) + f[k * n + j] - feq(k, r, u, v);
    };
    const column = (x, from, inlet) => {
      for (let y = 0; y < ny; y++) {
        const i = y * nx + x;
        if (this.solid[i]) continue;
        if (inlet) {
          const [u, v] = typeof inlet.u === 'function' ? inlet.u(y) : inlet.u;
          for (let k = 0; k < Q; k++) f[k * n + i] = feq(k, 1, u, v);
        } else {
          pressureOutlet(i, y * nx + from);
        }
      }
    };
    const row = (y, from, inlet) => {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        if (this.solid[i]) continue;
        if (inlet) {
          const [u, v] = typeof inlet.u === 'function' ? inlet.u(x) : inlet.u;
          for (let k = 0; k < Q; k++) f[k * n + i] = feq(k, 1, u, v);
        } else {
          pressureOutlet(i, from * nx + x);
        }
      }
    };
    const apply = (side, fn, edge, inner) => {
      if (side.type === 'inlet') fn(edge, inner, side);
      else if (side.type === 'outlet') fn(edge, inner, null);
    };
    apply(bc.left, column, 0, 1);
    apply(bc.right, column, nx - 1, nx - 2);
    apply(bc.bottom, row, 0, 1);
    apply(bc.top, row, ny - 1, ny - 2);
  }

  step(count = 1) {
    for (let s = 0; s < count; s++) {
      this.collide();
      this.stream();
      this.applyOpenBoundaries();
      this.time++;
    }
    return this;
  }

  // Refresh macroscopic fields from the current distributions (post-stream).
  moments() {
    const { nx, ny, f, rho, ux, uy, solid } = this;
    const n = nx * ny;
    const [Fx, Fy] = this.force;
    for (let i = 0; i < n; i++) {
      if (solid[i]) { rho[i] = 1; ux[i] = 0; uy[i] = 0; continue; }
      let r = 0, mx = 0, my = 0;
      for (let k = 0; k < Q; k++) {
        const fk = f[k * n + i];
        r += fk;
        mx += fk * EX[k];
        my += fk * EY[k];
      }
      rho[i] = r;
      ux[i] = (mx + 0.5 * Fx) / r;
      uy[i] = (my + 0.5 * Fy) / r;
    }
    return this;
  }

  totalMass() {
    const n = this.nx * this.ny;
    let m = 0;
    for (let i = 0; i < n; i++) if (!this.solid[i]) for (let k = 0; k < Q; k++) m += this.f[k * n + i];
    return m;
  }

  // Vorticity (lattice units) by central differences; zero on solids and edges.
  vorticity(out = new Float64Array(this.nx * this.ny)) {
    const { nx, ny, ux, uy, solid } = this;
    out.fill(0);
    for (let y = 1; y < ny - 1; y++)
      for (let x = 1; x < nx - 1; x++) {
        const i = y * nx + x;
        if (solid[i]) continue;
        out[i] = 0.5 * (uy[i + 1] - uy[i - 1]) - 0.5 * (ux[i + nx] - ux[i - nx]);
      }
    return out;
  }
}

// Lid-driven cavity preset: walls everywhere, top lid moving at uLid (lattice units).
export function lidDrivenCavity({ n = 64, re = 100, uLid = 0.1 }) {
  const nu = (uLid * n) / re;
  return new LBM2D({
    nx: n,
    ny: n,
    tau: 3 * nu + 0.5,
    boundaries: {
      left: { type: 'wall' },
      right: { type: 'wall' },
      bottom: { type: 'wall' },
      top: { type: 'wall', u: [uLid, 0] },
    },
  });
}

// Schäfer–Turek style channel: parabolic inlet, outlet, no-slip channel walls, cylinder.
export function cylinderChannel({ d = 20, re = 100, uMax = 0.1, lengthD = 22, heightD = 4.1, offsetD = 2, yOffsetD = 2 }) {
  const nx = Math.round(lengthD * d);
  const ny = Math.round(heightD * d);
  const uMean = (2 / 3) * uMax;
  const nu = (uMean * d) / re;
  // Channel walls sit half a node outside the first/last row (half-way bounce-back).
  const profile = (y) => {
    const s = (y + 0.5) / ny;
    return [4 * uMax * s * (1 - s), 0];
  };
  const sim = new LBM2D({
    nx,
    ny,
    tau: 3 * nu + 0.5,
    boundaries: {
      left: { type: 'inlet', u: profile },
      right: { type: 'outlet' },
      bottom: { type: 'wall' },
      top: { type: 'wall' },
    },
  });
  const cx = offsetD * d, cy = yOffsetD * d - 0.5;
  sim.addCylinder(cx, cy, d / 2);
  sim.init(1, (x, y) => profile(y));
  sim.meta = { d, re, uMax, uMean, nu, cx, cy };
  return sim;
}
