# Finite Volume vs. Lattice Boltzmann

A source-linked research note, a reproducible benchmark plan, and live browser demos for choosing between finite-volume (FVM) and lattice-Boltzmann (LBM) CFD for an underwater vehicle or other flow-coupled robotics project.

**Live site:** https://shubin123.github.io/submarine/ · Research note: [research.md](research.md)

## Demos

| Page | What it runs |
| --- | --- |
| [FVM vs LBM cavity](https://shubin123.github.io/submarine/demos/cavity.html) | Both solvers at Re = 100, scored live against Ghia et al. (1982) |
| [Cylinder wake](https://shubin123.github.io/submarine/demos/cylinder.html) | LBM Schäfer–Turek channel: vortex street, C<sub>D</sub>/C<sub>L</sub>, Strouhal number |
| [Lattice units](https://shubin123.github.io/submarine/demos/units.html) | Physical → lattice conversion with stability warnings |
| [Vehicle + Gazebo](https://shubin123.github.io/submarine/demos/vehicle.html) | Reduced-order AUV model driven by a replaceable drag table; gz-sim Hydrodynamics SDF export |

## Libraries

Dependency-free ES modules in `site/lib/` that run in browsers and in Node:

- `lbm.js`: D2Q9 lattice Boltzmann solver (BGK, Guo forcing, bounce-back, inlet/outlet, momentum-exchange forces)
- `fvm.js`: staggered-grid finite-volume incompressible Navier–Stokes solver (projection + conjugate gradients)
- `units.js`: physical ↔ lattice unit conversion
- `hydro.js`: ITTC friction, Lamb added mass, a manoeuvring model, drag tables, and Gazebo SDF export
- `reference.js`: Ghia (1982) and Schäfer–Turek (1996) reference data

## Development

```sh
npm test          # regression tests (Node ≥ 20, no dependencies)
npm run serve     # http://localhost:8000
```

## Scope

The demos verify both methods on canonical 2D laminar cases. They are not a vehicle CFD result: no OpenFOAM/OpenLB/Palabos run or hull geometry is included yet, and the vehicle coefficients are illustrative.

## Publishing

GitHub Actions runs the test suite, then deploys `site/` (plus `research.md`) to GitHub Pages whenever `main` changes. A failing test blocks the deploy.
