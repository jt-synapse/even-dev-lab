# Status

Updated: 2026-11-14

## Current milestone

**M1 Foundation — complete.** Ready to start M2 (diagnostic app). Application, simulator, and device readiness are unverified and were not attempted.

## Completed in M0–M1

- Fresh Git repository on branch `main`, connected to `origin` (`https://github.com/jt-synapse/even-dev-lab.git`, ADR-001).
- Blueprint preserved unchanged at `docs/WORKSPACE_BLUEPRINT.md` (SHA-256 `2a324a4c…b307`, verified across the move; excluded from formatting).
- Pinned toolchain: Node 24.22.1 (mise/`.nvmrc`/`engines`), Yarn 4.18.1 via Corepack, `node-modules` linker, one lockfile. Exact foundation devDependencies (ADR-002, ADR-003). One recorded deviation: ESLint 10.14.0 instead of 10.15.0, which was inside Yarn's 24 h quarantine gate at install time.
- Doctor environment checker (`scripts/doctor.mjs`) with strict `checkJs` typing and unit tests covering missing tool, pin mismatch/disagreement, configured git remote, missing dependencies, subprocess timeout, and secret redaction.
- Commands: `doctor`, `format`, `format:check`, `lint`, `typecheck`, `test`, `check`. No placeholder app/build/simulator/pack scripts.
- Documentation: README, AGENTS (including two-speed ceremony for `experiments/*` and `.agents/skills/` standard), capability register (CAP-001…014, including G2 mic, phone-camera WebView Q&A, and local API proxy boundaries), compatibility record, ADR-001…003, testing layers (Node 24 built-in runner selected for M2 TS domain/adapter tests) and pending hardware matrix, resolved/sequenced open questions.

## Verification performed

All runs on 2026-11-14, Node 24.22.1, Yarn 4.18.1 (Corepack), TypeScript 7.0.2, ESLint 10.14.0, Prettier 3.10.1:

- `corepack yarn install` — **passed** (84 packages fetched/added, 55.97 MiB; first attempt after the ESLint pin change hit one transient network fetch error and succeeded on retry).
- `corepack yarn check` in this repo — **passed, exit 0**: doctor “foundation ready (0 warning(s))”, Prettier “All matched files use Prettier code style!”, ESLint and `tsc` clean, 7/7 doctor tests passed.
- Clean-copy proof — **passed**: copied the repo without `node_modules` to a temp directory, `corepack yarn install --immutable` succeeded from the committed lockfile, then `corepack yarn check` passed there with the same results. Caveat: in the build sandbox, a cold Yarn global-cache fetch was refused by the network proxy (HTTP 403), so the clean copy linked from the machine-level Yarn cache warmed by this repo's first (cold-fetch) install. Lockfile immutability and README-only setup are proven; a cold-cache fetch on an unrestricted network was proven by the first install, not re-proven in the copy.
- Doctor negative paths — **passed via tests**: missing git, node pin mismatch, mise/`.nvmrc` disagreement, missing dependencies, subprocess timeout, secret redaction.
- Repository hygiene — **confirmed**: `git remote -v` empty, branch `main`, `git status` lists only intended foundation files, `node_modules/`, `artifacts/`, `.env`, and `*.ehpk` are ignored. Blueprint SHA-256 unchanged after a full-repo Prettier run.

## Blueprint §16 foundation checklist mapping

- [x] Scope remains a multi-tool G2/R1 development lab
- [x] Runtime, package manager, and tool versions recorded (SDK versions recorded as M2 candidates)
- [x] Clean setup can follow the README without undocumented global dependencies
- [x] Dependencies and (future) app manifests have clear owners
- [x] Formatting, lint, type, and test workflows working; **build is M2** — no app exists yet
- [x] Agent instructions concise and source-aware
- [ ] Simulator automation — **pending M3**, not attempted
- [x] Real-device validation kept separate and accurately labelled (all pending)
- [x] Unknown capabilities not presented as confirmed
- [x] Local packaging does not exist yet and nothing uploads or publishes
- [x] No speculative backend, product UI, or agent infrastructure added

## Blockers and unverified assumptions

- Global `evenhub` CLI/simulator shims on this machine are broken (mise shim with no version set). Recorded as deferred evidence; M2 installs project-local, recorded versions instead.
- Simulator 0.9.5's emulated SDK surface is unconfirmed; docs and registry disagree (`contradicted` in the capability register).
- TypeScript 7.0.2 against the official template, SDK types, and TS lint tooling is unverified — M2 entry gate (ADR-003).
- Phone/device/app/firmware details and developer access unknown (open questions 3–4). M4 stays blocked until hardware is exercised.
- No first commit yet; evidence records from M2 onward need commit hashes.

## Recommended next action

Start **M2**: install the recorded candidate versions as project dependencies, run the ADR-003 TypeScript gate against the official template, then build the minimal diagnostic app under `apps/device-lab/` with a thin SDK adapter. Consider making the first commit of this foundation before M2 work begins.
