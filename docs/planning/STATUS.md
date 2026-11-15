# Status

Updated: 2026-11-15

## Current milestone

**M4 Hardware baseline — complete.** All `9 / 9` cases in the hardware matrix (`docs/testing/TESTING.md` `HW-001`–`HW-009`) have been executed by JT against the static `vite preview` production build of `apps/device-lab` (`976de10`, port `4173`) on **`iPhone 17 Pro Max` / `iOS 27.2`**, **`Even App v2.4.0`**, **`Even G2 2.4.0.24`**, and **`Even R1 2.3.2.0008`**. Sanitized WebView captures are archived locally under gitignored `artifacts/hw/2026-11-15/`, directly verified platform behaviors (`CAP-001`, `CAP-002`, `CAP-003`, `CAP-005`, `CAP-006`, `CAP-008`) are promoted to `verified-device` in `docs/platform/CAPABILITIES.md`, and `scripts/doctor.mjs` now reports `[ok] hardware` from `docs/testing/TESTING.md` rather than unconditionally hardcoding `deferred`. Next milestone: **M5 (Packaging and CI)**.

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

## Completed in M3 & M4 hardware prep (building on M2 commit `2c6e89d`)

- Built repeatable automated simulator harness (`scripts/test-sim.mjs`, `scripts/sim-harness.mjs`, `scripts/png-inspect.mjs`) wired to `corepack yarn test:sim` with unit coverage in `scripts/sim-harness.test.mjs`.
- Updated `apps/device-lab/src/main.ts` `[device-lab] STATE` console telemetry to emit `seq=... last=... origin=...` for deterministic state progression checks.
- Updated `apps/device-lab/vite.config.ts` and `apps/device-lab/package.json` (`preview:lab`) to support `DEV_HOST`, `DEV_PORT`, and `PREVIEW_PORT`, and added `--url=` plus loopback guidance to `scripts/qr-lab.mjs`.
- Hardened process-group teardown (`detached` POSIX process groups) in both `scripts/sim-harness.mjs` and `scripts/sim-lab.mjs` so wrapped `evenhub-simulator` native binaries never linger.
- Recorded the verified `evenhub-simulator@0.9.5` `/api/console?since_id=` strict `id > since_id` contract in `.agents/skills/evenhub-simulator/SKILL.md`.
- Added non-fatal best-effort `bridge.getDeviceInfo()` cold-start telemetry (`model`, `isCharging`, `isInCase`, `isWearing`, `connectType`, `batteryLevel`, explicitly omitting `sn`) in `apps/device-lab/src/even/adapter.ts` and surfaced it in `apps/device-lab/src/ui/phone-view.ts`.
- Authored step-by-step M4 hardware baseline instructions for all 9 matrix cases in `docs/testing/M4_HARDWARE_RUNBOOK.md`.

## Verification performed (2026-11-14)

- `corepack yarn check` passed (exit `0`): `doctor` (0 failures, 0 warnings; hardware `deferred`), `format:check`, `eslint`, `typecheck` (root + `apps/device-lab`), `test` (`19/19` root + `16/16` `device-lab`), Vite build (`dist/index.html` 3.16 kB, `dist/assets/index-gh8ugOij.js` 89.99 kB).
- `corepack yarn test:sim` passed (exit `0`, ~1.5s) against `evenhub-simulator@0.9.5`: verified console readiness, `getDeviceInfo()` compatibility (`g2 · connected · 100% · worn` in WebView), zero runtime or trailing bridge errors, `576×288` RGBA alpha framebuffer (`litPixels=4913`, `transparentPixels=160975`), state + localized diff transitions across `click` → `down` → `up` → `long_press` → `long_press_release` → `click`, clean process-group exit, and artifacts written under gitignored `artifacts/sim/latest/`.
- Physical G2/R1 hardware matrix: **not run** (`0/9` cases executed; blocked on physical phone + G2 + R1 execution by JT).

## Completed in M4 (2026-11-15, building on M3 commit `976de10`)

- **Physical hardware matrix (`9 / 9` pass — `docs/testing/TESTING.md` `HW-001`–`HW-009`):**
  - **Cases 1–5 & lifecycle wire captures (screenshots archived under gitignored `artifacts/hw/2026-11-15/`):** Verified `BRIDGE READY`, `onLaunchSource("appMenu")`, initial `g2 · connected · 100% · worn` telemetry, live `onDeviceStatusChanged` update (`100%` -> `99%`), crisp `576×288` G2 border and typography with no edge clipping, `Row 3 of 3` clamping, all three `sysEvent.eventSource` origins (`1` right temple, `2` R1 ring, `3` left temple) across taps/double-tap/long-press/release, protobuf `CLICK_EVENT = 0` omission (`{"sysEvent":{"eventSource":2}}`), `textEvent` omitting `eventSource` even from R1 (`{"textEvent":{"containerID":1,"containerName":"diag-main","eventType":2}}`), native `"Close this feature?"` modal + listener survival on cancel, and `sysEvent` `FOREGROUND_ENTER_EVENT` (`4`) / `FOREGROUND_EXIT_EVENT` (`5`).
  - **Cases 6–9 (operator-verified live checks):** Confirmed BLE disconnect (~10s) and reconnect recovery, 15s phone app-backgrounding with G2 inputs, 15–20s iOS screen lock/unlock recovery without `BRIDGE ERROR`, and ~15s Wi-Fi + Cellular offline loop (Bluetooth ON) against static `vite preview` port `4173`.
- **Platform & compatibility records (`CAPABILITIES.md`, `COMPATIBILITY.md`, `OPEN_QUESTIONS.md`):**
  - Promoted `CAP-001`, `CAP-002`, `CAP-003`, `CAP-005`, `CAP-006`, and `CAP-008` to `verified-device` for `iPhone 17 Pro Max` / `iOS 27.2` + `Even App v2.4.0` + `G2 2.4.0.24` + `R1 2.3.2.0008`. Kept `CAP-004` (`verified-simulator`), `CAP-009`..`CAP-011` (`unknown`), `CAP-012`..`CAP-013` (`documented`), and `CAP-014` (`proposed`).
- **Doctor hardware matrix inspection (`scripts/doctor.mjs`, `scripts/doctor.test.mjs`):**
  - Added pure `inspectHardwareBaseline(testingMd)` helper so `corepack yarn doctor` inspects `docs/testing/TESTING.md` (without probing live BLE), reporting `ok` (`9/9 pass`), `deferred` (missing or partial matrix), or `warn` (recorded `fail`), covered by 2 new unit tests (`10/10` total in `doctor.test.mjs`).

## Verification performed in M4 (2026-11-15)

- `corepack yarn check` — **passed, exit 0**:
  - `doctor`: `[ok] hardware: M4 baseline recorded (9/9 pass in docs/testing/TESTING.md; CLI does not live-probe BLE)`, `0` failures, `0` warnings.
  - `format:check`, `lint`, and `typecheck`: `0` errors across root + `apps/device-lab`.
  - `test`: `21/21` root tests (`doctor.test.mjs` `10/10` + `sim-harness.test.mjs` `11/11`) + `16/16` `device-lab` tests passed.
  - `build`: `vite build` produced `apps/device-lab/dist/` (`index.html` 3.16 kB, `assets/index-gh8ugOij.js` 89.99 kB).
- `corepack yarn test:sim` — **passed, exit 0** against `evenhub-simulator@0.9.5` (all steps green, clean process-group exit).
- `docs/WORKSPACE_BLUEPRINT.md` SHA-256 unchanged (`2a324a4cd45ce0c956453c02e2600f32a2859f9e66598fa9a3493443cd15b307`).

## Blueprint §16 readiness checklist

- [x] Scope remains a multi-tool G2/R1 development lab
- [x] Runtime, package manager, SDK, CLI, and simulator versions pinned and exercised locally
- [x] Clean setup follows the README without global Even/Yarn dependencies
- [x] Dependencies and `apps/device-lab/app.json` have clear package ownership
- [x] Formatting, lint, typecheck, unit/adapter tests, and Vite build run in `corepack yarn check`
- [x] Agent instructions and `.agents/skills/` are concise, portable, and verified against installed types
- [x] Repeatable simulator automation command (`corepack yarn test:sim`)
- [x] Real-device validation kept strictly separate and recorded (`9/9` M4 baseline in `docs/testing/TESTING.md`)
- [x] Unknown/untested capabilities never presented as device-verified
- [x] Local packaging (`evenhub pack`) separated from external account/upload/publish actions
- [x] Zero speculative backend, product UI, or shared package premature extraction

## Remaining unknowns

- Untested phones/OS versions (especially **Android** host WebView behavior) and future Even App / G2 / R1 firmware updates.
- Multi-container layouts (`CAP-004` `2..4` containers, lists, images) on physical G2, offline cold-start of a packaged `.ehpk` (`M5`), `CAP-010` (phone-paired Bluetooth keyboard), `CAP-012` (mic streaming), and `CAP-013` (native camera/album bridge) (`M6` experiments).

## Recommended next action

Execute **M5 (Packaging and CI)**: add a repeatable local `pack:lab` script (via `./node_modules/.bin/evenhub pack`, strictly zero login/upload/publish) and add a `.github/workflows/` CI workflow mirroring `corepack yarn check` on pinned Node `24.22.1` + Corepack Yarn `4.18.1`.
