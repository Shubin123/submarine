# Finite Volume vs. Lattice Boltzmann for vehicle-flow simulation

**Research date:** 2026-09-23

**Question:** Which numerical route—finite volume (FVM) or lattice Boltzmann (LBM)—is more appropriate for a flow study that may later connect to a Gazebo submarine / robotic-vehicle simulation?

## Executive conclusion

Use **finite volume** as the primary engineering solver when the deliverable needs conventional Reynolds-averaged turbulence modelling, free surfaces, strongly non-uniform or body-fitted meshes, high-Mach/compressible flow, or a well-established verification and validation path. OpenFOAM is a natural open-source baseline.

Use **lattice Boltzmann** when the case is predominantly low-Mach and its geometry can be represented accurately on a lattice; it is especially compelling for complex porous or moving geometry, multiphase/microfluidic research, and high-throughput regular-grid hardware. OpenLB and Palabos are credible open-source starting points. Treat its apparent simplicity as conditional: boundary treatment, lattice resolution, dimensional-to-lattice-unit conversion, stability, and model validation determine whether it is actually cheaper.

Use **Gazebo as the robot and control-integration environment, not as either CFD solver.** Its standard physics layer abstracts rigid-body engines, and its buoyancy support computes force from displaced volume. A CFD result should be reduced to an interface—a hydrodynamic lookup table, added-mass/damping model, force/moment plugin, or co-simulation link—then validated at the vehicle level.

## What the methods solve

FVM integrates conservation laws over each control volume, converting surface fluxes and volume sources into an algebraic system. This conservative formulation works naturally on structured or unstructured meshes; OpenFOAM documents its applications as primarily FVM on unstructured meshes and expresses scalar transport in conservative form. [OpenFOAM schemes documentation](https://doc.openfoam.com/2606/tools/processing/numerics/schemes/)

LBM advances particle-distribution functions along a small set of discrete lattice velocities through collision and streaming. Macroscopic density and velocity are recovered from their moments. OpenLB describes itself as a C++ framework for LBM across multiphysics transport; Palabos likewise describes a general-purpose CFD framework with an LBM kernel. [OpenLB](https://www.openlb.net/) · [Palabos](https://palabos.unige.ch/)

Both can approximate the same continuum low-Mach flow regime. They are not interchangeable implementations with a universal winner: accuracy targets, geometry, flow physics, implementation quality, and hardware decide the outcome. Direct comparisons exist, including a laminar benchmark study spanning LBM, finite element, and FVM, and a multicomponent-flow comparison. [Benchmark study](https://www.sciencedirect.com/science/article/pii/S0045793005001519) · [multicomponent comparison](https://doi.org/10.1002/cjce.23634)

## Decision matrix

| Criterion | Finite volume | Lattice Boltzmann |
| --- | --- | --- |
| Governing representation | Discretized continuum conservation equations | Discrete kinetic distribution evolution; recover continuum moments |
| Mesh / geometry | Strong choice for body-fitted, local refinement, and unstructured grids | Native collision-streaming favors regular lattices; geometry is often voxelized or immersed-boundary represented |
| Conservation | Flux balance per control volume is explicit | Conserves appropriate moments through collision/streaming; boundary schemes need scrutiny |
| Low-Mach incompressible flow | Mature, broad tool support | Natural and often attractive, provided low lattice Mach number and stable unit mapping |
| Compressibility / shocks | Broad, mature engineering practice | Specialized compressible models needed; not the default choice |
| Turbulence | Wide RANS/LES/DES ecosystem | LES and turbulence models exist, but model/boundary validation remains application-specific |
| Multiphase / complex microgeometry | Capable but interface modelling and meshing can be costly | Frequently attractive; implementation choice still matters |
| Parallel hardware | Mature MPI and unstructured-grid workflows; performance depends on sparse memory access | Local, regular update pattern maps well to parallel accelerators, but is commonly memory-bandwidth-bound |
| Main risk | Mesh quality, discretization/solver choices, model calibration | Stair-step boundaries, lattice-unit scaling, low-Mach/stability constraints, physics-model maturity |

## Tool roles and boundaries

### FVM baseline: OpenFOAM

OpenFOAM is the recommended baseline for a vehicle drag, wake, or propulsor-adjacent study. Choose a solver and turbulence/free-surface model that match the actual physics, construct a mesh-convergence study, then compare force and pressure-derived coefficients—not just colourful flow fields. Its finite-volume library and CFD tools are part of the standard distribution. [OpenFOAM library reference](https://www.openfoam.com/documentation/user-guide/a-reference/a.3-standard-libraries)

### LBM candidate: OpenLB or Palabos

For an LBM branch, start with a canonical case bundled or documented by the chosen framework, then transfer the exact nondimensional conditions to the vehicle geometry. OpenLB publishes a user-guide history and a current project page; Palabos is explicitly an open-source parallel LBM solver. [OpenLB user guides](https://www.openlb.net/user-guide/) · [Palabos project](https://gitlab.com/palabos)

### AeroToolbox

The supplied name appears to refer to **AeroToolbox.com**, a site of aeronautical educational/calculator material, not a general FVM or LBM solver. It can help with back-of-the-envelope aerodynamic context, but it should not be described as the CFD benchmark engine without identifying a different, specific package. [AeroToolbox about page](https://www.aerotoolbox.com/about/)

### Gazebo

Current Gazebo is a 3D robotics simulator; its physics layer selects rigid-body physics engines at runtime (DART is documented as default) and supports extensions through plugins. Its buoyancy feature applies force based on fluid density and displaced volume. Those capabilities are useful for vehicle dynamics, controller development, and scenario playback, but do not resolve a vehicle wake or boundary layer. [Gazebo getting started](https://github.com/gazebosim/docs/blob/master/common/get_started.md) · [Gazebo Physics](https://gazebosim.org/libs/physics/) · [buoyancy concept](https://gazebosim.org/api/physics/6/physicsconcepts.html)

## Fair benchmark plan

Do not compare wall-clock time until the solutions have comparable errors. A defensible first campaign is:

1. **Canonical verification:** run 2D lid-driven cavity and flow around a cylinder at matched Reynolds number. Report drag, lift RMS/Strouhal number, velocity profiles, residual/steady-state criteria, and grid/lattice refinement.
2. **Geometry transfer:** use the same watertight vehicle hull, reference area, length, density, viscosity, inflow, and boundary placement. Keep blockage ratio and near-wall resolution explicit.
3. **Physics ladder:** begin steady, single-phase, incompressible flow. Add unsteadiness, turbulence, free surface, propulsor modelling, or manoeuvring one at a time only after the prior level passes checks.
4. **Equalize accuracy:** refine until the selected integrated outputs change by an agreed tolerance (for example, 1–2% for drag coefficient) and compare against an analytic, experimental, or trusted reference where available.
5. **Record cost honestly:** report cells/lattice sites, time step, simulated time, core/GPU model, wall time, memory, compilation/options, and all preprocessing/postprocessing. An LBM site count and an FVM cell count are not automatically equivalent degrees of freedom.
6. **Couple to Gazebo:** fit hydrodynamic coefficients/lookup tables from the accepted CFD data; apply them in a Gazebo force plugin; validate manoeuvres against the CFD conditions or physical data. Preserve the source case and coefficients alongside the plugin version.

## Minimum acceptance criteria

- Mass conservation and physical boundary conditions are checked for every run.
- Force coefficients and key velocity/pressure observables show refinement convergence.
- The LBM run documents lattice Mach number, relaxation parameters, boundary scheme, and physical-unit conversion.
- The FVM run documents mesh metrics, discretization schemes, solver tolerances, turbulence/wall treatment, and time-step control.
- No method is declared faster or more accurate without matched-error evidence.

## Recommendation for this project

Start with an **OpenFOAM FVM baseline** for the submarine hull because it reduces geometry and engineering-model risk. In parallel, build an **OpenLB or Palabos LBM proof of concept** on the same simplified, low-Mach, single-phase case. Promote LBM only if it meets the same integrated-force and flow-field acceptance criteria at lower end-to-end cost on the intended hardware. Feed the validated result into Gazebo as a reduced-order hydrodynamic model rather than attempting to make Gazebo the CFD environment.

## Limits of this note

This is a research synthesis and experiment design, not a completed CFD study. No tool was executed here, no geometry was supplied, and no performance or accuracy result is asserted. The next implementation step is to define the hull/flow conditions and run the benchmark plan.
