# Status

Updated: 2026-11-14

## Current milestone

**M2 Diagnostic — complete.** `apps/device-lab` builds cleanly, enforces a strict domain/SDK boundary, passes unit + adapter tests on Node 24's built-in runner, packages locally via `evenhub pack`, and renders + responds to input in `evenhub-simulator@0.9.5`. Physical G2/R1 device checks remain **not run** (deferred to M4).

## Completed in M2 (building on M1 commit `787b2ca`)

- **Pinned Even Hub & app dependencies (`COMPATIBILITY.md`, `ADR-003`):**
  - Installed `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5` (`sim-darwin-arm64@0.9.5`), and `vite@8.3.8` in `apps/device-lab`, plus `typescript-eslint@8.72.2` at the workspace root.
  - Executed the ADR-003 M2 entry gate: stepped `typescript` from `7.0.2` to `6.0.3` to satisfy `typescript-eslint@8.72.2`'s `<6.1.0` peer range, and verified clean `--noEmit` + `vite build` on the official `evenhub-templates/minimal` snapshot (`8cb01354f5ee914c5fab97d06e6d13b28eeb5815`) and installed SDK `0.0.16` `.d.ts`.
- **Diagnostic app (`apps/device-lab/`):**
  - Pure domain state machine and `576×288` glasses text formatter (`src/domain/diagnostic.ts`) with ESLint-enforced zero SDK/DOM imports.
  - Thin Even SDK boundary (`src/even/adapter.ts`) with bounded readiness/RPC timeouts, serialized container updates, protobuf zero-value click normalization (`eventType === undefined` -> `"tap"`), honest `source: "unknown"` when `eventSource` is omitted, explicit failure in non-bridge browsers (plus explicit `?mock=1` harness), and deterministic listener teardown.
  - Companion WebView diagnostic UI (`src/ui/phone-view.ts`, `src/main.ts`) rendering live telemetry, glasses container preview, sanitized event log, and mock controls.
  - 10 domain + adapter tests (`test/domain.test.ts`, `test/adapter.test.ts`) running directly on `node --test`.
- **Workspace scripts & portable skills:**
  - Wired `dev:lab`, `sim:lab`, `qr:lab`, `build`, `typecheck`, `test`, and `check`; upgraded `scripts/doctor.mjs` to require and verify project-local `evenhub` (`0.2.0`) and `evenhub-simulator` (`0.9.5`).
  - Adapted four concise skills under `.agents/skills/` from `even-realities/everything-evenhub` (`cb8321fbe2a11d5aaf08fa12088cbe9b9fc5bac2`, MIT), aligned with SDK `0.0.16` types, `corepack yarn`, and strict no-login/no-upload rules.
- **Capability discoveries (`CAPABILITIES.md`):**
  - Promoted `CAP-001`…`CAP-004`, `CAP-006` (simulator scroll omission), `CAP-007`, and `CAP-008` to `verified-simulator`.
  - Resolved the M1 simulator `0.9.3` vs `0.9.5` contradiction via the installed `0.9.5` changelog.
  - Verified in SDK `0.0.16` `.d.ts` that `bridge.captureImageFromCamera()` and `bridge.pickImageFromAlbum()` provide native companion-bridge image capture (`CAP-013`), `bridge.audioControl(isOpen, AudioInputSource)` supports G2/Phone mics (`CAP-012`), and upstream `everything-evenhub` `setBackgroundState` / `onBackgroundRestore` are not exported in `0.0.16`.

## Verification performed in M2 (2026-11-14)

- `corepack yarn check` — **passed, exit 0**:
  - `doctor`: `0` failures, `0` warnings (`local evenhub 0.2.0, evenhub-simulator 0.9.5`; hardware `deferred` to M4).
  - `format:check`, `lint` (`eslint@10.14.0` + `typescript-eslint@8.72.2`), and `typecheck` (`typescript@6.0.3` across root + `apps/device-lab`): `0` errors.
  - `test`: `8/8` doctor tests + `10/10` `device-lab` domain & adapter tests passed.
  - `build`: `vite build` produced `apps/device-lab/dist/` cleanly (`88.88 kB` bundle).
- Local `.ehpk` packaging check — **passed**: `evenhub pack apps/device-lab/app.json apps/device-lab/dist --sdk-ver 0.0.16 -o artifacts/device-lab-m2.ehpk` succeeded locally (`38,461` bytes; no login or upload invoked).
- Live simulator verification (`evenhub-simulator@0.9.5` + `vite@8.3.8`) — **passed**:
  - `/api/ping` -> `pong`; console emitted `[device-lab] APP_READY mode=bridge` and `STATE phase=READY taps=0 focus=0 status=ready`.
  - Initial `/api/screenshot/glasses` verified `576×288` 8-bit RGBA PNG with `4,913` lit pixels (`A > 0`).
  - `POST /api/input` `{"action":"click"}` + `{"action":"down"}` transitioned to `STATE phase=ACTIVE taps=1 focus=1 status=ready` (`Last: scroll_down (unknown)`) and updated `/api/screenshot/glasses` (`5,244` lit pixels; framebuffer diff `true`).
- Hardware checks — **not run** (physical G2 glasses, R1 ring, and target phone Even app deferred to M4).

## Blueprint §16 readiness checklist

- [x] Scope remains a multi-tool G2/R1 development lab
- [x] Runtime, package manager, SDK, CLI, and simulator versions pinned and exercised locally
- [x] Clean setup follows the README without global Even/Yarn dependencies
- [x] Dependencies and `apps/device-lab/app.json` have clear package ownership
- [x] Formatting, lint, typecheck, unit/adapter tests, and Vite build run in `corepack yarn check`
- [x] Agent instructions and `.agents/skills/` are concise, portable, and verified against installed types
- [ ] Repeatable simulator automation command (`corepack yarn test:sim`) — **next in M3**
- [x] Real-device validation kept strictly separate and marked **not run** (M4)
- [x] Unknown/untested capabilities never presented as device-verified
- [x] Local packaging (`evenhub pack`) separated from external account/upload/publish actions
- [x] Zero speculative backend, product UI, or shared package premature extraction

## Remaining unknowns

- Repeatable simulator smoke suite (`corepack yarn test:sim`) with clean socket/process exit and structured artifact output is **M3** (in M2 verification, Node `fetch` keep-alive handles required explicit process exit awareness after child teardown — carry into M3 harness design).
- Physical G2/R1 hardware behavior: real `eventSource` values (`1` right temple, `2` R1 ring, `3` left temple), optical legibility, BLE latency, companion-app version (`>= 2.2.10`), and phone background/lock behavior remain **not run** until M4.

## Recommended next action

Start **M3 (Simulator automation)**: build `scripts/test-sim.mjs` + `corepack yarn test:sim` to run deterministic headless/automated simulator boot, console readiness assertions, input-sequence state checks, and `576×288` RGBA alpha-channel screenshot verification with guaranteed child-process cleanup and artifact capture under `artifacts/`.
