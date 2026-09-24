// Reduced-order vehicle hydrodynamics: the interface between CFD results and a
// robotics simulator. Dependency-free ES module (browser + Node).
//
// Conventions: body frame x forward, y starboard, z down (SNAME/Fossen). Depth z > 0.
// Coefficients exported for Gazebo follow the gz-sim Hydrodynamics system's SNAME
// derivative convention (resisting derivatives are negative).

// ITTC-1957 model–ship correlation line.
export const ittcFriction = (re) => 0.075 / (Math.log10(re) - 2) ** 2;

// Hoerner form factor for streamlined bodies of revolution (d/l = diameter / length).
export const hoernerFormFactor = (dOverL) => 1 + 1.5 * dOverL ** 1.5 + 7 * dOverL ** 3;

// Lamb's added-mass coefficients for a prolate spheroid with semi-axes a > b = c.
export function spheroidAddedMass(a, b) {
  const e = Math.sqrt(Math.max(1 - (b * b) / (a * a), 1e-8));
  const L = Math.log((1 + e) / (1 - e));
  const alpha0 = ((2 * (1 - e * e)) / e ** 3) * (0.5 * L - e);
  const beta0 = 1 / (e * e) - ((1 - e * e) / (2 * e ** 3)) * L;
  const k1 = alpha0 / (2 - alpha0);
  const k2 = beta0 / (2 - beta0);
  const kRot = (e ** 4 * (beta0 - alpha0)) / ((2 - e * e) * (2 * e * e - (2 - e * e) * (beta0 - alpha0)));
  return { k1, k2, kRot };
}

export const HULL_PRESETS = {
  auv: { label: 'Small torpedo AUV (1.6 m × 0.19 m)', length: 1.6, diameter: 0.19 },
  glider: { label: 'Slender glider hull (2.0 m × 0.22 m)', length: 2.0, diameter: 0.22 },
  rov: { label: 'Stubby inspection hull (0.9 m × 0.35 m)', length: 0.9, diameter: 0.35 },
};

// Coefficient table: drag coefficient on frontal area vs Reynolds number (length-based).
// Accepts CFD-derived tables; interpolates linearly in log10(Re), clamped at the ends.
export function makeDragTable({ re, cd, source = 'user' }) {
  if (re.length !== cd.length || re.length < 1) throw new Error('re and cd must be equal-length, non-empty arrays');
  const pts = re.map((r, i) => [Math.log10(r), cd[i]]).sort((p, q) => p[0] - q[0]);
  const lookup = (r) => {
    const x = Math.log10(Math.max(r, 1));
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++)
      if (x <= pts[i][0]) {
        const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
      }
    return pts[pts.length - 1][1];
  };
  return { source, re: [...re], cd: [...cd], lookup };
}

// Empirical frontal-area drag table from ITTC friction × form factor.
export function empiricalDragTable({ length, diameter, reList = [1e5, 3e5, 1e6, 3e6, 1e7, 3e7] }) {
  const k = hoernerFormFactor(diameter / length);
  const wetted = Math.PI * diameter * length * 0.85; // cylinder-with-nose/tail approximation
  const frontal = (Math.PI * diameter * diameter) / 4;
  return makeDragTable({
    source: 'ITTC-1957 friction × Hoerner form factor',
    re: reList,
    cd: reList.map((re) => (ittcFriction(re) * k * wetted) / frontal),
  });
}

// Build a vehicle parameter set from hull dimensions and fluid properties.
export function buildVehicle({ length, diameter, rho = 1025, nu = 1.19e-6, dragTable, massRatio = 1 }) {
  const a = length / 2, b = diameter / 2;
  const volume = 0.85 * Math.PI * b * b * length;
  const mass = massRatio * rho * volume;
  const { k1, k2, kRot } = spheroidAddedMass(a, b);
  const iz = (mass * (length * length + 3 * b * b)) / 12;
  const frontal = Math.PI * b * b;
  const side = length * diameter * 0.9;
  const table = dragTable ?? empiricalDragTable({ length, diameter });
  // Cross-flow drag (Cd ≈ 1.1 circular cylinder) for sway/heave; yaw via integrated strip theory.
  const cdCross = 1.1;
  return {
    length, diameter, rho, nu, volume, mass, iz, frontal, side, table,
    addedMass: { x: k1 * rho * volume, y: k2 * rho * volume, z: k2 * rho * volume, r: kRot * iz },
    quad: {
      y: 0.5 * rho * cdCross * side,
      z: 0.5 * rho * cdCross * side,
      r: (0.5 * rho * cdCross * diameter * length ** 4) / 32,
    },
    // Small linear terms keep low-speed motion well damped (illustrative, not identified).
    linear: { x: 0.05 * mass, y: 0.5 * mass, z: 0.5 * mass, r: 0.5 * iz },
    rudder: { y: 0.5 * rho * 0.012 * 2 * Math.PI, n: -0.5 * rho * 0.012 * 2 * Math.PI * length * 0.45 },
  };
}

// Surge quadratic drag coefficient [kg/m] at forward speed u.
export function surgeQuadratic(veh, u) {
  const re = Math.max(Math.abs(u) * veh.length / veh.nu, 1);
  return 0.5 * veh.rho * veh.table.lookup(re) * veh.frontal;
}

// State: [x, y, z, psi, u, v, w, r]. Controls: { thrust [N], rudder [rad], ballast [N, + heavy] }.
export function derivatives(veh, s, ctl) {
  const [, , z, psi, u, v, w, r] = s;
  const mx = veh.mass + veh.addedMass.x;
  const my = veh.mass + veh.addedMass.y;
  const mz = veh.mass + veh.addedMass.z;
  const iz = veh.iz + veh.addedMass.r;
  const xuu = surgeQuadratic(veh, u);
  const uu = u * Math.abs(u);
  let fz = ctl.ballast ?? 0;
  if (z <= 0 && fz < 0) fz = 0; // surfaced: positive buoyancy holds it at the surface
  const du = (ctl.thrust + my * v * r - xuu * u * Math.abs(u) - veh.linear.x * u) / mx;
  const dv = (-mx * u * r + veh.rudder.y * uu * ctl.rudder - veh.quad.y * v * Math.abs(v) - veh.linear.y * v) / my;
  const dr = (veh.rudder.n * uu * ctl.rudder - veh.quad.r * r * Math.abs(r) - veh.linear.r * r) / iz;
  const dw = (fz - veh.quad.z * w * Math.abs(w) - veh.linear.z * w) / mz;
  const c = Math.cos(psi), sn = Math.sin(psi);
  return [u * c - v * sn, u * sn + v * c, w, r, du, dv, dw, dr];
}

export function rk4(veh, s, ctl, dt) {
  const add = (a, b, h) => a.map((x, i) => x + h * b[i]);
  const k1 = derivatives(veh, s, ctl);
  const k2 = derivatives(veh, add(s, k1, dt / 2), ctl);
  const k3 = derivatives(veh, add(s, k2, dt / 2), ctl);
  const k4 = derivatives(veh, add(s, k3, dt), ctl);
  const out = s.map((x, i) => x + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  if (out[2] < 0) { out[2] = 0; out[6] = Math.max(out[6], 0); }
  return out;
}

// Steady surge speed for a thrust, found by bisection on the force balance.
export function steadySpeed(veh, thrust) {
  let lo = 0, hi = 50;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const resist = surgeQuadratic(veh, mid) * mid * mid + veh.linear.x * mid;
    if (resist > thrust) hi = mid; else lo = mid;
  }
  return 0.5 * (lo + hi);
}

// Gazebo (gz-sim) Hydrodynamics system snippet; derivatives linearised at the design speed.
export function toGazeboSdf(veh, { linkName = 'base_link', designSpeed = 1.5 } = {}) {
  const f = (x) => (-x).toPrecision(6);
  const tags = {
    xDotU: veh.addedMass.x,
    yDotV: veh.addedMass.y,
    zDotW: veh.addedMass.z,
    nDotR: veh.addedMass.r,
    xUabsU: surgeQuadratic(veh, designSpeed),
    xU: veh.linear.x,
    yVabsV: veh.quad.y,
    yV: veh.linear.y,
    zWabsW: veh.quad.z,
    zW: veh.linear.z,
    nRabsR: veh.quad.r,
    nR: veh.linear.r,
  };
  const body = Object.entries(tags).map(([k, v]) => `  <${k}>${f(v)}</${k}>`).join('\n');
  return `<plugin filename="gz-sim-hydrodynamics-system" name="gz::sim::systems::Hydrodynamics">
  <link_name>${linkName}</link_name>
  <water_density>${veh.rho}</water_density>
${body}
</plugin>
<!-- Drag source: ${veh.table.source}; xUabsU linearised at u = ${designSpeed} m/s. -->`;
}
