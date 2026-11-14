# ADR-002: Runtime and package-manager pins

Status: accepted (2026-11-14)

## Context

The blueprint proposes Yarn workspaces with the `node-modules` linker until Plug'n'Play compatibility is established, a currently supported Node LTS compatible with the Even toolchain, exact recorded versions, and no unbounded `latest` (§5, §6.2). Official Even docs require Node `^20 || >=22` and exclude Node 18.

## Decision

- Node **24.22.1** exactly, pinned in `mise.toml`, `.nvmrc`, and `engines`. mise is the recorded version manager.
- Yarn **4.18.1** via the `packageManager` field and Corepack (`corepack yarn …`). No global Yarn is required or installed. `nodeLinker: node-modules`; one committed `yarn.lock`.
- Foundation devDependencies are exact pins (see `docs/platform/COMPATIBILITY.md`). `@types/node` follows the Node 24 types line, not registry latest.
- Yarn's default `npmMinimalAgeGate` (24 h quarantine for newly published packages) stays **enabled** as supply-chain hygiene.

## Deviation recorded

ESLint is pinned to **10.14.0**, not 10.15.0: at install time (2026-11-14) 10.15.0 was ~22 hours old and quarantined by the age gate. 10.14.0 is the newest release that clears the gate. Upgrading to 10.15.0+ is a deliberate one-line pin change once it ages in; it is not required for M1.

## Consequences

- Fresh installs are reproducible with `corepack yarn install --immutable` from the lockfile.
- The doctor fails on pin disagreement (running Node vs `.nvmrc`, `mise.toml` vs `.nvmrc`, Corepack Yarn vs `packageManager`).

## Revisit trigger

Node 24 leaving LTS support, an Even toolchain release requiring a different runtime, or workspace scripts proving insufficient (only then consider a monorepo orchestrator).
