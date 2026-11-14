# Agent instructions — even-dev-lab

This is a multi-tool Even Realities G2/R1 development lab. No product has been selected. The governing specification is `docs/WORKSPACE_BLUEPRINT.md`; the active milestone and next action are in `docs/planning/STATUS.md`.

## Toolchain contract

- Node **24.22.1** exactly (`mise.toml`, `.nvmrc`, `engines`). Yarn **4.18.1** via Corepack: invoke as `corepack yarn <cmd>`; Yarn is not on PATH.
- One lockfile (`yarn.lock`), `node-modules` linker. Declare direct dependencies in the package that consumes them; do not rely on hoisting.
- Quality gate: `corepack yarn check` (doctor, format, lint, typecheck, tests). Run it before declaring work done.
- Do not install unbounded `latest`, modify global/shell configuration, or disable Yarn's `npmMinimalAgeGate`. A quarantined version means: wait, or pin the previous release and record why.

## Platform rules

- Verify SDK and CLI contracts against the **installed** packages and their type definitions before adding device calls. Documentation snippets are not verified contracts.
- Keep platform claims in `docs/platform/CAPABILITIES.md` with their evidence state. Simulator evidence never becomes a device claim. Update the register when an assumption changes.
- Application domain logic must not import SDK or browser globals; the Even integration layer is the only SDK boundary (blueprint §3).

## Working rules

- Preserve unrelated work. Make the smallest change that completes the current milestone step; do not expand scope (no speculative backend, product UI, agent infrastructure, or shared packages without a second consumer).
- Two-speed ceremony: apply full ADR, `CAPABILITIES.md`, and formal evidence rigor to SDK, simulator, hardware discoveries, and promoted `apps/` or `packages/`; keep `experiments/*` lightweight until promoted (never overstating capability states).
- Workspace skills live in `.agents/skills/<name>/SKILL.md` (portable across Antigravity and CLI agents) and must obey this repo's `corepack yarn` and no-publish rules.
- Bounded subprocess calls with timeouts; sanitized output; never print environment dumps, tokens, or account configuration.
- Local packaging is distinct from login, upload, tester invitations, and publication. Never perform those external actions unless the user explicitly requests them.
- Mark hardware checks as **not run** when devices are unavailable. Never fabricate a run, a result, or a hardware observation.
- Report what changed, what ran, the actual results, remaining unknowns, and the next action. Update `docs/planning/STATUS.md` when a milestone state changes.
