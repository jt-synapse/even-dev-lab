# Compatibility record

All versions below were checked against npm registry metadata on **2026-11-14**. “Pinned” means installed in this repo and exercised by `corepack yarn check`. “Candidate” means researched for a later milestone — not installed, not run.

## Pinned foundation toolchain (M1)

| Tool        | Version | Why this version                                                                            |
| ----------- | ------- | ------------------------------------------------------------------------------------------- |
| Node        | 24.22.1 | Current official LTS on this machine; satisfies every engine range below                    |
| Yarn        | 4.18.1  | Via Corepack (`packageManager`); `node-modules` linker; one lockfile                        |
| Prettier    | 3.10.1  | Registry latest on 2026-11-14                                                               |
| ESLint      | 10.14.0 | 10.15.0 was inside Yarn's 24 h `npmMinimalAgeGate` quarantine at install time — see ADR-002 |
| @eslint/js  | 10.0.1  | Registry latest on 2026-11-14                                                               |
| TypeScript  | 7.0.2   | Registry latest; M1 use is `checkJs` over tooling only — see ADR-003                        |
| @types/node | 24.19.2 | Deliberately the Node 24 types line; registry latest overall is the Node 26 line            |

Version manager: mise (project pin in `mise.toml`). `.nvmrc` and `engines` carry the same pin for other setups. The doctor fails if the running Node disagrees with the pin.

## M2 candidates (researched, not installed)

| Package                            | Candidate | Published engine range (Node)          | Permits Node 24? |
| ---------------------------------- | --------- | -------------------------------------- | ---------------- |
| `@evenrealities/even_hub_sdk`      | 0.0.16    | `^20.0.0 \|\| >=22.0.0`                | Yes              |
| `@evenrealities/evenhub-cli`       | 0.2.0     | `^20.17.0 \|\| ^22.13.0 \|\| >=23.5.0` | Yes              |
| `@evenrealities/evenhub-simulator` | 0.9.5     | none declared                          | Unproven         |
| `vite`                             | 8.3.8     | `^20.19.0 \|\| >=22.12.0`              | Yes              |

Notes:

- SDK 0.0.16 declares `minAppVersion: 2.2.10`. Record the actual Even app and firmware versions when hardware testing starts (M4).
- An engine range permitting Node 24 is not a compatibility proof. The simulator declaring no engine range proves nothing either way. Both are resolved by running the M2 diagnostic, not by reading metadata.
- Official docs install the CLI and simulator globally (`npm install -g …`). This lab will prefer project-local, recorded versions (blueprint §6.2); if a tool turns out to require a global install, record its exact version and check command here.
- Official skills bundle: `even-realities/everything-evenhub` @ `cb8321fbe2a11d5aaf08fa12088cbe9b9fc5bac2` (2026-10-21). Deferred to M2; re-check HEAD then.

## Known unknowns carried into M2

- Whether TypeScript 7.0.2 is clean against the official template and TypeScript lint tooling (ADR-003 revisit trigger).
- Which SDK surface simulator 0.9.5 actually emulates (`contradicted` record in `CAPABILITIES.md`).
- Phone OS/model, Even app version, and G2/R1 firmware for the target hardware (open questions).
