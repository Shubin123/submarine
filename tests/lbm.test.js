import test from 'node:test';
import assert from 'node:assert/strict';
import { LBM2D, lidDrivenCavity, cylinderChannel, feq, W, Q } from '../site/lib/lbm.js';
import { GHIA_RE100_U, GHIA_RE100_V, maxDeviation } from '../site/lib/reference.js';

test('equilibrium weights sum to one and reproduce density at rest', () => {
  assert.ok(Math.abs(W.reduce((a, b) => a + b) - 1) < 1e-15);
  let s = 0;
  for (let k = 0; k < Q; k++) s += feq(k, 1.3, 0, 0);
  assert.ok(Math.abs(s - 1.3) < 1e-14);
});

test('rejects non-positive viscosity', () => {
  assert.throws(() => new LBM2D({ nx: 4, ny: 4, tau: 0.5 }), RangeError);
});

test('periodic box conserves mass to round-off', () => {
  const sim = new LBM2D({ nx: 32, ny: 32, tau: 0.8 });
  sim.init(1, (x, y) => [0.05 * Math.sin((2 * Math.PI * y) / 32), 0.05 * Math.cos((2 * Math.PI * x) / 32)]);
  const m0 = sim.totalMass();
  sim.step(500);
  assert.ok(Math.abs(sim.totalMass() / m0 - 1) < 1e-12);
});

test('force-driven Poiseuille flow matches the analytic parabola', () => {
  const ny = 21, tau = 0.8, g = 1e-6;
  const sim = new LBM2D({
    nx: 4, ny, tau, force: [g, 0],
    boundaries: { bottom: { type: 'wall' }, top: { type: 'wall' } },
  });
  sim.step(6000).moments();
  const nu = sim.viscosity;
  let maxErr = 0, peak = 0;
  for (let y = 0; y < ny; y++) {
    const yy = y + 0.5; // walls half a node outside
    const exact = (g / (2 * nu)) * yy * (ny - yy);
    peak = Math.max(peak, exact);
    maxErr = Math.max(maxErr, Math.abs(sim.ux[sim.idx(1, y)] - exact));
  }
  assert.ok(maxErr / peak < 5e-3, `relative error ${maxErr / peak}`);
});

test('LBM lid-driven cavity at Re=100 matches Ghia et al. (1982)', () => {
  const n = 32;
  const sim = lidDrivenCavity({ n, re: 100, uLid: 0.1 });
  sim.step(40000).moments();
  const cu = [{ y: 0, u: 0 }, { y: 1, u: 1 }];
  const cv = [{ x: 0, v: 0 }, { x: 1, v: 0 }];
  for (let y = 0; y < n; y++) cu.push({ y: (y + 0.5) / n, u: (0.5 * (sim.ux[y * n + n / 2 - 1] + sim.ux[y * n + n / 2])) / 0.1 });
  for (let x = 0; x < n; x++) cv.push({ x: (x + 0.5) / n, v: (0.5 * (sim.uy[(n / 2 - 1) * n + x] + sim.uy[(n / 2) * n + x])) / 0.1 });
  assert.ok(maxDeviation(cu, GHIA_RE100_U, 'y', 'u') < 0.02);
  assert.ok(maxDeviation(cv, GHIA_RE100_V, 'x', 'v') < 0.02);
});

test('cylinder channel produces positive drag and stays finite', () => {
  const sim = cylinderChannel({ d: 8, uMax: 0.15 });
  sim.step(1500);
  const { uMean, d } = sim.meta;
  const cd = sim.bodyForce[0] / (0.5 * uMean * uMean * d);
  assert.ok(Number.isFinite(cd) && cd > 1 && cd < 10, `Cd = ${cd}`);
});
