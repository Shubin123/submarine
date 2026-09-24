import test from 'node:test';
import assert from 'node:assert/strict';
import { CavityFVM } from '../site/lib/fvm.js';
import { GHIA_RE100_U, GHIA_RE100_V, maxDeviation } from '../site/lib/reference.js';

test('FVM cavity at Re=100 converges and matches Ghia et al. (1982)', () => {
  const sim = new CavityFVM({ n: 32, re: 100 }).solveSteady({ tol: 1e-4 });
  assert.ok(sim.lastChange < 1e-4, 'reached steady state');
  assert.ok(sim.maxDivergence() < 1e-6, `divergence ${sim.maxDivergence()}`);
  assert.ok(maxDeviation(sim.centerlineU(), GHIA_RE100_U, 'y', 'u') < 0.01);
  assert.ok(maxDeviation(sim.centerlineV(), GHIA_RE100_V, 'x', 'v') < 0.015);
});

test('FVM error shrinks under grid refinement (16 → 32)', () => {
  const err = (n) => maxDeviation(new CavityFVM({ n }).solveSteady({ tol: 1e-4 }).centerlineU(), GHIA_RE100_U, 'y', 'u');
  assert.ok(err(32) < err(16));
});
