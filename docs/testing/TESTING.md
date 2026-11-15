# Testing and evidence

## Layers

| Layer          | Validates                                             | Does not prove                                    |
| -------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Unit tests     | State transitions, input mapping, validation          | Real bridge or device behaviour                   |
| Adapter tests  | Normalization, cleanup, error paths using fixtures    | Firmware compatibility                            |
| Simulator      | Rendered content, navigation, supported input, errors | BLE timing, ergonomics, true background behaviour |
| Real device    | Readability, ring/temple input, lifecycle, reconnect  | Other untested phones or firmware versions        |
| Packaged build | Artifact integrity, installed-build behaviour         | Public review acceptance                          |

In M1 the only tests are the doctor's unit tests (`scripts/doctor.test.mjs`, Node's built-in runner): healthy machine, missing tool, pin mismatch, pin disagreement, missing dependencies, subprocess timeout, and secret redaction. From M2 onward, TypeScript domain and SDK-adapter tests also run on Node 24's built-in test runner (`node --test`), avoiding extra test-runner bloat until browser/DOM harness needs justify more.

## Simulator rules (from M3)

Start the dev server, start the simulator, wait for actual app readiness, capture initial state, inject a supported action, verify the expected state/rendering, capture logs, clean up every process the script started. A nonempty screenshot is not proof of the expected screen; prefer state checks and meaningful image assertions. Verify endpoint contracts against the installed simulator version — do not copy unverified documentation snippets into automation.

Run `corepack yarn test:sim` to execute the automated simulator suite (`scripts/test-sim.mjs`, `scripts/sim-harness.mjs`, `scripts/png-inspect.mjs`). Latest run outputs (and failure screenshots/logs on failure) are saved under gitignored `artifacts/sim/latest/`.

## Hardware matrix — M4 baseline complete (9 / 9)

All **9 / 9** physical hardware baseline cases were executed on **2026-11-15** by JT against the static production build of `apps/device-lab` (commit `976de10`, served via `vite preview` on port `4173` over LAN QR — no HMR traffic) on **`iPhone 17 Pro Max` / `iOS 27.2`**, **`Even App v2.4.0`**, **`Even G2 2.4.0.24`**, and **`Even R1 2.3.2.0008`**. These results establish a device baseline for the tested phone, OS, app, and firmware stack only; untested phones (including Android) and future firmware versions remain outside this evidence boundary.

| Case                          | Status |
| ----------------------------- | ------ |
| Cold start                    | pass   |
| Repeated navigation           | pass   |
| Long-press / release          | pass   |
| Ring absent                   | pass   |
| Ring present                  | pass   |
| Disconnect / reconnect        | pass   |
| Phone foreground / background | pass   |
| Screen lock / unlock          | pass   |
| Network loss                  | pass   |

## Evidence record template

One record per executed check, kept with the relevant milestone or experiment notes:

- Date:
- Commit:
- App / package:
- SDK, CLI, simulator, Node versions:
- Phone model / OS:
- Even app version:
- G2 firmware / R1 firmware:
- Scenario:
- Expected result:
- Observed result:
- Status (pass / fail / blocked):
- Artifact references (screenshots, logs — under `artifacts/`, never committed):
- Capability IDs affected:

Hardware tests the agent cannot perform remain pending; the specific check is handed to JT with the scenario written out.

## M4 hardware evidence records (2026-11-15)

### HW-001 — Cold start

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008`
- Scenario: Launch `apps/device-lab` via Even App developer QR launcher (`http://<lan-ip>:4173`) with G2 worn and verify bridge startup, `Host Context`, and `576×288` G2 lens rendering.
- Expected result: Badge reaches `BRIDGE READY` without error, `Host Context` populates launch source and device status, and G2 renders cleanly inside `576×288` bounds with readable contrast and margins.
- Observed result: WebView reached `BRIDGE READY`; `Host Context` reported `launchSource = "appMenu"` and `g2 · connected · 100% · worn`; operator confirmed visually on physical G2 lenses that the border looks good and text is crisp with no clipping. (Screenshot-captured WebView state + operator-verified live optics check.)
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `artifacts/hw/2026-11-15/01-cold-start-and-lifecycle.png`
- Capability IDs affected: `CAP-001`, `CAP-002`, `CAP-003`, `CAP-008`

### HW-002 — Repeated navigation

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008`
- Scenario: Exercise repeated scroll up/down gestures, single taps, row clamping `[1]`..`[3]`, and double-tap exit prompt cancel followed by resumed input.
- Expected result: Focus clamps cleanly across rows `1..3`, taps toggle `READY`/`ACTIVE`, and canceling the host exit dialog leaves SDK listeners alive for subsequent controls.
- Observed result: Alternating scrolls reached `Scroll: ^5 / v5` (`Row 2 of 3`) and clamped cleanly at `Row 3 of 3` (`Scroll: ^0 / v3`, `#23` `eventType: 1`, `#2`/`#14`/`#15` `eventType: 2`). Double-tap (`#6` `{"sysEvent":{"eventType":3,"eventSource":2}}`) triggered `shutDownPageContainer(1)` and opened the native `"Close this feature?"` modal (`#7` `foreground_enter`, `#8` `foreground_exit`); canceling kept the HUD responsive and the next tap (`#9` `{"sysEvent":{"eventSource":2}}`) immediately stepped `Taps` from `2` to `3` (`Phase: ACTIVE`).
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `artifacts/hw/2026-11-15/01-cold-start-and-lifecycle.png`, `artifacts/hw/2026-11-15/03-double-tap-cancel-recovery.png`, `artifacts/hw/2026-11-15/04-ring-absent-temples-and-status.png`
- Capability IDs affected: `CAP-002`, `CAP-005`, `CAP-006`

### HW-003 — Long-press / release

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008`
- Scenario: Hold (~1s) and release on R1 ring, left G2 temple, and inspect `sysEvent` wire payloads (`LONG_PRESS_EVENT`, `LONG_PRESS_RELEASE_EVENT`, and `eventSource`).
- Expected result: `sysEvent` emits `eventType: 9` and `10` with distinct physical `eventSource` IDs (`1` right temple, `2` ring, `3` left temple).
- Observed result: R1 ring emitted `#4` `{"sysEvent":{"eventType":9,"eventSource":2}}` and `#5` `{"sysEvent":{"eventType":10,"eventSource":2}}` (`Last: long_press_release (ring)`). Left G2 temple emitted `#16` `{"sysEvent":{"eventType":9,"eventSource":3}}` and `#17` `{"sysEvent":{"eventType":10,"eventSource":3}}` (`Last: long_press_release (glasses_left)`). Right temple `sysEvent` (`#13`) also preserved `eventSource: 1` (`glasses_right`).
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `artifacts/hw/2026-11-15/02-ring-present-and-long-press.png`, `artifacts/hw/2026-11-15/04-ring-absent-temples-and-status.png`
- Capability IDs affected: `CAP-005`, `CAP-006`

### HW-004 — Ring absent

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008` (docked in case)
- Scenario: Place R1 ring in charging case so only G2 + iPhone are active; trigger right-temple and left-temple gestures.
- Expected result: G2 operates with zero errors waiting on R1, temple events never misreport `ring`, and omitted `eventSource` on `textEvent` normalizes to `unknown`.
- Observed result: Zero errors; `#13` (`{"sysEvent":{"eventSource":1}}`) normalized to `glasses_right`, `#16`/`#17` (`eventSource: 3`) normalized to `glasses_left`, and temple scroll-downs (`#14`/`#15` `{"textEvent":{"containerID":1,"containerName":"diag-main","eventType":2}}`) omitted `eventSource` (`unknown`). `Host Context` also reflected live `onDeviceStatusChanged` battery telemetry (`g2 · connected · 99% · worn`).
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `artifacts/hw/2026-11-15/04-ring-absent-temples-and-status.png`
- Capability IDs affected: `CAP-005`, `CAP-006`, `CAP-008`

### HW-005 — Ring present

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008`
- Scenario: With R1 worn and paired alongside G2, execute R1-only tap, swipe down, long-press/release, and double-tap + cancel.
- Expected result: R1 gestures drive HUD transitions identically to temple controls, and `eventSource: 2` (`ring`) vs omitted `textEvent` origin behavior is observed.
- Observed result: R1 taps (`#1`, `#3`, `#9`: `{"sysEvent":{"eventSource":2}}`, protobuf omitting `CLICK_EVENT = 0`), long-press/release (`#4`, `#5`: `eventSource: 2`), and double-tap (`#6`: `{"sysEvent":{"eventType":3,"eventSource":2}}`) all resolved to `ring`; R1 swipe down (`#2`: `{"textEvent":{"containerID":1,"containerName":"diag-main","eventType":2}}`) arrived without `eventSource` (`unknown`), confirming firmware omits `eventSource` on `textEvent` even when initiated by R1.
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `artifacts/hw/2026-11-15/02-ring-present-and-long-press.png`, `artifacts/hw/2026-11-15/03-double-tap-cancel-recovery.png`
- Capability IDs affected: `CAP-005`, `CAP-006`

### HW-006 — Disconnect / reconnect

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008`
- Scenario: Toggle iPhone Bluetooth OFF for ~10s with `Even Device Lab` open, re-enable Bluetooth, wait for reconnect, and tap G2 temple.
- Expected result: Bridge and G2 HUD recover cleanly after BLE reconnect without broken session state.
- Observed result: Operator executed BLE disconnect (~10s), reconnected, and triggered temple input cleanly with automatic HUD recovery; reported pass (operator-verified live check).
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `none — operator-verified live`
- Capability IDs affected: `CAP-001`, `CAP-008`

### HW-007 — Phone foreground / background

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008`
- Scenario: Background Even App on iPhone for ~15s while triggering 2 taps + 1 scroll on G2, then return Even App to foreground.
- Expected result: Lifecycle transitions log accurately and session/HUD continue cleanly upon returning to foreground.
- Observed result: Wire capture confirmed `sysEvent` lifecycle emissions (`#24`/`#7` `{"sysEvent":{"eventType":4}}` `foreground_enter`, `#25`/`#8` `{"sysEvent":{"eventType":5}}` `foreground_exit` setting Phase subtitle to `background`/`foreground`), and operator verified ~15s app-background G2 input test passed live (screenshot-captured lifecycle wire payloads + operator-verified live background run).
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `artifacts/hw/2026-11-15/01-cold-start-and-lifecycle.png` (lifecycle wire payloads) + `operator-verified live`
- Capability IDs affected: `CAP-001`, `CAP-005`

### HW-008 — Screen lock / unlock

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008`
- Scenario: Lock `iPhone 17 Pro Max` screen for ~15–20s while performing 2 taps + 1 swipe on G2, then unlock back into `Even App v2.4.0`.
- Expected result: G2 session remains usable and unlocks back to `BRIDGE READY` with no `BRIDGE ERROR` or dropped listener state.
- Observed result: Operator reported pass after lock/unlock cycle with G2 input responsiveness and clean recovery (operator-verified live check).
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `none — operator-verified live`
- Capability IDs affected: `CAP-001`

### HW-009 — Network loss

- Date: 2026-11-15
- Commit: `976de10`
- App / package: `apps/device-lab` (`@even-dev-lab/device-lab`, static `vite preview` bundle)
- SDK, CLI, simulator, Node versions: `@evenrealities/even_hub_sdk@0.0.16`, `@evenrealities/evenhub-cli@0.2.0`, `@evenrealities/evenhub-simulator@0.9.5`, `vite@8.3.8`, Node `24.22.1`, Yarn `4.18.1`
- Phone model / OS: `iPhone 17 Pro Max` / `iOS 27.2`
- Even app version: `v2.4.0`
- G2 firmware / R1 firmware: `2.4.0.24` / `2.3.2.0008`
- Scenario: With static `apps/device-lab` bundle loaded (`vite preview`, port `4173`, zero HMR WebSocket), disable Wi-Fi + Cellular while keeping Bluetooth on for ~15s of G2 inputs, then restore Wi-Fi and tap once more.
- Expected result: Already-loaded local WebView plugin drives G2 updates purely over local BLE/bridge without network calls or forced reload.
- Observed result: Operator reported pass across offline window and Wi-Fi restoration; local bridge/HUD loop operated offline cleanly (operator-verified live check; offline cold-start from packaged `.ehpk` remains M5).
- Status (pass / fail / blocked): `pass`
- Artifact references (screenshots, logs — under `artifacts/`, never committed): `none — operator-verified live`
- Capability IDs affected: `CAP-001`, `CAP-011` (loaded local WebView loop only; `CAP-011` remains `unknown` overall)
