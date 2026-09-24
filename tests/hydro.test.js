import test from 'node:test';
import assert from 'node:assert/strict';
import { toLattice, reynolds, FLUIDS } from '../site/lib/units.js';
import {
  ittcFriction, spheroidAddedMass, buildVehicle, HULL_PRESETS, rk4, steadySpeed,
  makeDragTable, toGazeboSdf, surgeQuadratic,
} from '../site/lib/hydro.js';
import { interp } from '../site/lib/reference.js';

test('lattice conversion is self-consistent', () => {
  const r = toLattice({ length: 1.6, speed: 2, nu: FLUIDS.seawater15.nu, cells: 400, uLattice: 0.05 });
  assert.ok(Math.abs(r.re - reynolds(2, 1.6, FLUIDS.seawater15.nu)) < 1e-6);
  assert.ok(Math.abs(r.nuLattice - (0.05 * 400) / r.re) < 1e-15);
  assert.ok(r.warnings.some((w) => w.includes('τ')), 'flags an unstable τ at high Re');
  const easy = toLattice({ length: 1, speed: 0.1, nu: 1e-3, cells: 100, uLattice: 0.05 });
  assert.equal(easy.warnings.length, 0);
  assert.ok(Math.abs(easy.cellsForTau(easy.tau) - 100) <= 1);
});

test('ITTC-1957 friction line reference value', () => {
  assert.ok(Math.abs(ittcFriction(1e7) - 0.075 / 25) < 1e-15);
});

test('Lamb added mass: sphere limit and slender-body limits', () => {
  const s = spheroidAddedMass(1, 0.9999);
  assert.ok(Math.abs(s.k1 - 0.5) < 1e-3 && Math.abs(s.k2 - 0.5) < 1e-3);
  const slender = spheroidAddedMass(1, 0.05);
  assert.ok(slender.k1 < 0.02 && slender.k2 > 0.97);
});

test('vehicle reaches the analytic steady speed under constant thrust', () => {
  const veh = buildVehicle(HULL_PRESETS.auv);
  let s = [0, 0, 5, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) s = rk4(veh, s, { thrust: 15, rudder: 0, ballast: 0 }, 0.02);
  assert.ok(Math.abs(s[4] - steadySpeed(veh, 15)) < 1e-3);
  assert.ok(Math.abs(s[1]) < 1e-9 && Math.abs(s[2] - 5) < 1e-9, 'no spurious sway or heave');
});

test('rudder turns the vehicle and ballast sets depth rate', () => {
  const veh = buildVehicle(HULL_PRESETS.auv);
  let s = [0, 0, 1, 0, 1.5, 0, 0, 0];
  for (let i = 0; i < 1000; i++) s = rk4(veh, s, { thrust: 10, rudder: 0.2, ballast: 5 }, 0.02);
  assert.ok(Math.abs(s[3]) > 0.5, 'heading changed');
  assert.ok(s[2] > 1 && s[6] > 0, 'sinks when heavy');
  let t = [0, 0, 0.5, 0, 0, 0, 0, 0];
  for (let i = 0; i < 2000; i++) t = rk4(veh, t, { thrust: 0, rudder: 0, ballast: -5 }, 0.02);
  assert.equal(t[2], 0, 'buoyant vehicle surfaces and stops at z = 0');
});

test('CFD drag table plugs into the vehicle and the Gazebo export', () => {
  const table = makeDragTable({ source: 'CFD run 42', re: [1e5, 1e7], cd: [0.4, 0.2] });
  assert.ok(Math.abs(table.lookup(1e6) - 0.3) < 1e-12);
  const veh = buildVehicle({ ...HULL_PRESETS.auv, dragTable: table });
  assert.ok(surgeQuadratic(veh, 2) > 0);
  const sdf = toGazeboSdf(veh);
  assert.match(sdf, /gz-sim-hydrodynamics-system/);
  assert.match(sdf, /CFD run 42/);
  for (const m of sdf.matchAll(/<(\w+)>(-?[\d.e+-]+)<\/\1>/g)) {
    if (m[1] !== 'water_density') assert.ok(Number(m[2]) < 0, `${m[1]} should be negative`);
  }
});

test('reference interpolation', () => {
  assert.equal(interp([{ a: 0, b: 0 }, { a: 1, b: 2 }], 'a', 'b', 0.25), 0.5);
});
