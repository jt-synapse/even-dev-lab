# even-dev-lab

A fresh, reusable development workspace for building tools for Even Realities G2 glasses and the R1 ring. No product has been selected. This repository has completed **M0–M2**: pinned toolchain, environment doctor, adapted Even Hub agent skills, and the minimal `apps/device-lab` diagnostic app verified against the local EvenHub simulator (`0.9.5`). Physical G2/R1 device validation remains deferred to M4.

The governing specification is [docs/WORKSPACE_BLUEPRINT.md](docs/WORKSPACE_BLUEPRINT.md). Current status lives in [docs/planning/STATUS.md](docs/planning/STATUS.md).

## Setup from scratch

Prerequisites: Git, and a Node version manager. [mise](https://mise.jdx.dev/) is the recorded choice; any manager that honours `.nvmrc` works.

```sh
mise install          # installs the pinned Node from mise.toml (24.22.1)
corepack yarn install # Yarn 4.18.1 via Corepack; no global Yarn needed
corepack yarn check   # doctor + format + lint + typecheck + tests + build
```

Yarn is not expected on PATH. `corepack yarn <cmd>` is the working invocation everywhere in this repo; the `packageManager` field in `package.json` selects the exact Yarn version.

## Commands

| Command                            | What it does                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `corepack yarn doctor`             | Verifies host pins and project-local Even CLI/simulator (`0.2.0` / `0.9.5`); redacts keys    |
| `corepack yarn format`             | Reformats the repo with Prettier                                                             |
| `corepack yarn format:check`       | Fails if any file is unformatted                                                             |
| `corepack yarn lint`               | ESLint (`eslint` + `typescript-eslint`, including domain SDK/DOM import boundaries)          |
| `corepack yarn typecheck`          | Strict TypeScript checks across root tooling (`checkJs`) and `apps/device-lab`               |
| `corepack yarn test`               | Runs `doctor` tests plus `apps/device-lab` domain and SDK-adapter tests (`node --test`)      |
| `corepack yarn build`              | Builds `apps/device-lab` production bundle with Vite                                         |
| `corepack yarn check`              | Runs `doctor`, `format:check`, `lint`, `typecheck`, `test`, and `build` in order             |
| `corepack yarn dev:lab`            | Starts the `apps/device-lab` Vite dev server (`127.0.0.1:5173`; append `?mock=1` in browser) |
| `corepack yarn sim:lab`            | Starts `apps/device-lab` dev server and attaches the project-local EvenHub simulator         |
| `corepack yarn qr:lab --url <url>` | Generates a local QR code for an explicit LAN URL (never triggers login or upload)           |

## Troubleshooting

- **Doctor fails on `node pin`** — the running Node is not `24.22.1`. Run `mise install` and use a shell where the project pin is active, or point your version manager at `.nvmrc`.
- **`corepack yarn` prompts or fails to fetch Yarn** — first run downloads Yarn `4.18.1` into the Corepack cache; it needs network once.
- **Install says a version is “quarantined”** — Yarn's `npmMinimalAgeGate` blocks packages published in the last 24 hours. Wait for the gate to pass or pin the previous release; do not disable the gate (see ADR-002).
- **Opening `http://127.0.0.1:5173` in a regular browser shows `BRIDGE FAILED`** — expected! Outside the Even App WebView or `evenhub-simulator`, the native Flutter bridge is absent (`createStartUpPageContainer` fails explicitly rather than faking readiness). Append `?mock=1` (`http://127.0.0.1:5173/?mock=1`) to exercise the deterministic browser mock harness.

## Repository layout

| Path                          | Purpose                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `apps/device-lab/`            | Minimal G2/R1 diagnostic app (`domain/`, thin `even/` SDK adapter, `ui/`, tests) |
| `.agents/skills/`             | Portable Even Hub SDK, input/lifecycle, simulator, and local CLI agent skills    |
| `scripts/`                    | Environment checker (`doctor`), `sim:lab`, and `qr:lab` local helper scripts     |
| `docs/WORKSPACE_BLUEPRINT.md` | The governing specification (preserved byte-identical)                           |
| `docs/platform/`              | Capability register, compatibility record, sources                               |
| `docs/decisions/`             | Architecture decision records (`ADR-001`…`ADR-003`)                              |
| `docs/testing/`               | Test layers, pending M4 hardware matrix, evidence template                       |
| `docs/planning/`              | Status, milestones, open questions                                               |
| `packages/`, `experiments/`   | Workspace globs declared; created on demand (shared code requires 2 consumers)   |

## Evidence discipline

Platform claims carry an evidence state (`documented`, `verified-simulator`, `verified-device`, `proposed`, `unknown`, `blocked`, `contradicted`) in [docs/platform/CAPABILITIES.md](docs/platform/CAPABILITIES.md). A simulator result never silently becomes a device claim. Hardware checks not yet run are listed as pending, never as passed.
