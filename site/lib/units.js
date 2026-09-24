// Physical ↔ lattice unit conversion and quick nondimensional checks.
// Dependency-free ES module (browser + Node).

export const FLUIDS = {
  seawater15: { label: 'Seawater, 15 °C', rho: 1025.9, nu: 1.1892e-6 },
  seawater20: { label: 'Seawater, 20 °C', rho: 1024.8, nu: 1.0508e-6 },
  freshwater20: { label: 'Fresh water, 20 °C', rho: 998.2, nu: 1.0034e-6 },
  air20: { label: 'Air, 20 °C, 1 atm', rho: 1.204, nu: 1.516e-5 },
};

export const reynolds = (u, length, nu) => (u * length) / nu;

// Map a physical case onto a D2Q9/D3Q19 BGK lattice.
//   length   characteristic length L [m]
//   speed    characteristic velocity U [m/s]
//   nu       kinematic viscosity [m²/s]
//   cells    lattice nodes across L
//   uLattice characteristic velocity in lattice units (sets the time step)
export function toLattice({ length, speed, nu, cells, uLattice = 0.05 }) {
  const re = reynolds(speed, length, nu);
  const dx = length / cells;
  const dt = (uLattice * dx) / speed;
  const nuLattice = (nu * dt) / (dx * dx);
  const tau = 3 * nuLattice + 0.5;
  const mach = uLattice * Math.sqrt(3);
  const warnings = [];
  if (tau < 0.51) warnings.push('τ < 0.51: BGK is likely unstable; add lattice nodes, raise uLattice, or use MRT/entropic/LES collision.');
  else if (tau < 0.55) warnings.push('τ < 0.55: near the BGK stability limit; expect sensitivity to resolution.');
  if (tau > 2) warnings.push('τ > 2: poor accuracy for BGK; lower uLattice or reduce resolution.');
  if (mach > 0.3) warnings.push('Lattice Mach > 0.3: compressibility error dominates.');
  else if (mach > 0.1) warnings.push('Lattice Mach > 0.1: compressibility error (∝ Ma²) is no longer negligible.');
  return {
    re,
    dx,
    dt,
    nuLattice,
    tau,
    mach,
    stepsPerSecond: 1 / dt,
    // Nodes needed across L to hit a target τ at the same uLattice.
    cellsForTau: (target) => Math.ceil((((target - 0.5) / 3) * re) / uLattice),
    warnings,
  };
}
