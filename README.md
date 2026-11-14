# even-dev-lab

A fresh, reusable development workspace for building tools for Even Realities G2 glasses and the R1 ring. No product has been selected. This repository currently contains the **M0–M1 foundation only**: pinned toolchain, an environment checker, and documentation. No application code exists yet — that starts at M2.

The governing specification is [docs/WORKSPACE_BLUEPRINT.md](docs/WORKSPACE_BLUEPRINT.md). Current status lives in [docs/planning/STATUS.md](docs/planning/STATUS.md).

## Setup from scratch

Prerequisites: Git, and a Node version manager. [mise](https://mise.jdx.dev/) is the recorded choice; any manager that honours `.nvmrc` works.

```sh
mise install          # installs the pinned Node from mise.toml (24.22.1)
corepack yarn install # Yarn 4.18.1 via Corepack; no global Yarn needed
corepack yarn check   # doctor + format + lint + typecheck + tests
```

Yarn is not expected on PATH. `corepack yarn <cmd>` is the working invocation everywhere in this repo; the `packageManager` field in `package.json` selects the exact Yarn version.

## Commands

| Command                      | What it does                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `corepack yarn doctor`       | Reports environment, pin agreement, and foundation readiness; never prints secrets |
| `corepack yarn format`       | Reformats the repo with Prettier                                                   |
| `corepack yarn format:check` | Fails if any file is unformatted                                                   |
| `corepack yarn lint`         | ESLint (flat config, JavaScript only in M1)                                        |
| `corepack yarn typecheck`    | Strict TypeScript `checkJs` over the tooling scripts                               |
| `corepack yarn test`         | Doctor tests on Node's built-in test runner                                        |
| `corepack yarn check`        | All of the above, in order — the local quality gate                                |

Deliberately absent in M1 (no placeholder scripts that fake success): app build, domain tests, simulator commands, and packaging. They arrive with the M2 diagnostic app.

## Troubleshooting

- **Doctor fails on `node pin`** — the running Node is not 24.22.1. Run `mise install` and use a shell where the project pin is active, or point your version manager at `.nvmrc`.
- **`corepack yarn` prompts or fails to fetch Yarn** — first run downloads Yarn 4.18.1 into the Corepack cache; it needs network once.
- **Install says a version is “quarantined”** — Yarn's `npmMinimalAgeGate` blocks packages published in the last 24 hours. Wait for the gate to pass or pin the previous release; do not disable the gate. (This is why ESLint is pinned to 10.14.0 — see ADR-002.)
- **Doctor reports Even tooling as `deferred`** — expected in M1. The SDK, CLI, and simulator are installed and verified in M2, as project dependencies with recorded versions.

## Repository layout

| Path                                 | Purpose                                                             |
| ------------------------------------ | ------------------------------------------------------------------- |
| `scripts/`                           | Environment checker (`doctor`) and its tests                        |
| `docs/WORKSPACE_BLUEPRINT.md`        | The governing specification (preserved unchanged)                   |
| `docs/platform/`                     | Capability register, compatibility record, sources                  |
| `docs/decisions/`                    | Architecture decision records                                       |
| `docs/testing/`                      | Test layers, hardware matrix, evidence template                     |
| `docs/planning/`                     | Status, milestones, open questions                                  |
| `apps/`, `packages/`, `experiments/` | Workspace globs declared; directories are created on demand from M2 |

Shared code is extracted only after a second concrete consumer exists (blueprint §12). No backend, MCP server, or agent framework is part of the foundation.

## Evidence discipline

Platform claims carry an evidence state (`documented`, `verified-simulator`, `verified-device`, `proposed`, `unknown`, `blocked`, `contradicted`) in [docs/platform/CAPABILITIES.md](docs/platform/CAPABILITIES.md). A simulator result never silently becomes a device claim. Hardware checks not yet run are listed as pending, never as passed.
