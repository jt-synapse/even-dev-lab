# Capability register

Evidence states (blueprint §4): `documented`, `verified-simulator`, `verified-device`, `proposed`, `unknown`, `blocked`, `contradicted`.

Each record carries a source, date, applicable versions, evidence state, limitation, and next action. Simulator runs establish `verified-simulator` only — **never** `verified-device`. Device claims apply only to configurations directly tested in M4 (`iPhone 17 Pro Max` / `iOS 27.2`, `Even App v2.4.0`, `G2 2.4.0.24`, `R1 2.3.2.0008`).

## Core platform capability summary

| ID      | Statement                                                                                        | State              | Next action                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------- |
| CAP-001 | Even Hub plugin logic runs in a companion WebView (`WKWebView` in macOS simulator / iOS EvenApp) | verified-device    | Validate Android host WebView & packaged `.ehpk` offline cold-start when tested     |
| CAP-002 | Glasses UI uses SDK containers (`createStartUpPageContainer`, `textContainerUpgrade`)            | verified-device    | Keep bounded upgrade coalescing; test multi-container transitions in M6 experiments |
| CAP-003 | Glasses framebuffer is `576 × 288` monochrome green (RGBA PNG with 4-bit alpha intensity in sim) | verified-device    | Re-check margins/readability on Android or denser list/image layouts in M6          |
| CAP-004 | Container limits (`<= 4` total per page; 1 `isEventCapture: 1` container) enforced by SDK/sim    | verified-simulator | Verify representative multi-container layouts (`> 1`) on physical G2 in M6          |
| CAP-005 | R1 ring and G2 temple controls supply tap, double-tap, scroll, and long-press events             | verified-device    | Verified on `G2 2.4.0.24` + `R1 2.3.2.0008` (`TESTING.md` `HW-002`..`HW-005`)       |
| CAP-006 | `textEvent`/`listEvent` omit `eventSource`; `sysEvent` preserves `1`/`2`/`3` since `0.0.15`      | verified-device    | Never infer origin from `textEvent`/`listEvent`; confirmed hardware matches SDK     |
| CAP-007 | Simulator `0.9.5` provides HTTP `/api/ping`, `/api/console`, `/api/input`, `/api/screenshot/*`   | verified-simulator | Covered by `corepack yarn test:sim` (`since_id` is strict `id > since_id`)          |
| CAP-008 | Simulator omits `onDeviceStatusChanged`, emits `eventSource=1` on click only, no BLE timing      | verified-device    | Live `onDeviceStatusChanged` (`100%`->`99%`), `onLaunchSource("appMenu")`, BLE ok   |
| CAP-009 | Direct generic Bluetooth keyboard-to-G2 pairing is available                                     | unknown            | No documented support; do not depend on it                                          |
| CAP-010 | A phone-paired keyboard can supply text to our plugin's WebView                                  | unknown            | Focus/text/shortcut/lock-state experiment on target phone (M6)                      |
| CAP-011 | All desired workflows work with no internet                                                      | unknown            | Loaded WebView loop passed `HW-009`; packaged `.ehpk` offline cold-start next (M5)  |
| CAP-012 | `bridge.audioControl(isOpen, AudioInputSource)` streams `16 kHz` PCM (`AudioEvent.audioPcm`)     | documented         | Exercise permission & stream lifecycle in dedicated post-M4 experiment              |
| CAP-013 | `bridge.captureImageFromCamera()` / `pickImageFromAlbum()` return native `AppImageAsset \| null` | documented         | Verify native camera/album bridge prompts & payload size on phone post-M4           |
| CAP-014 | Local Node/Vite dev API proxy holds `.env` provider keys server-side, off the client WebView     | proposed           | Keep M2–M5 zero-backend; introduce when first AI/media experiment starts            |

Do not encode a Bluetooth version into application logic: earlier sources disagreed (blueprint §4).

## Evidence added during M2 (2026-11-14)

### CAP-001, CAP-002, CAP-003, CAP-004, CAP-007, CAP-008 — Diagnostic app & simulator `0.9.5` (`verified-simulator`)

- **Source:** Installed `@evenrealities/even_hub_sdk@0.0.16` (`dist/index.d.ts`), `@evenrealities/evenhub-simulator@0.9.5` (`@evenrealities/sim-darwin-arm64@0.9.5`), and live execution against `apps/device-lab` on Node `24.22.1` (2026-11-14).
- **Applicable versions:** `even_hub_sdk@0.0.16`, `evenhub-simulator@0.9.5`, `evenhub-cli@0.2.0`, `vite@8.3.8`.
- **Executed verification:**
  - `createStartUpPageContainer` returned `StartUpPageCreateResult.success` (`0`) for a single `576×288` event-capturing text container (`isEventCapture: 1`); companion `WKWebView` logged `[device-lab] APP_READY mode=bridge` and `[device-lab] STATE phase=READY taps=0 focus=0 status=ready`.
  - `GET /api/screenshot/glasses` returned a `576×288` 8-bit RGBA PNG (`4,913` lit pixels with `A > 0`, `160,975` transparent background pixels).
  - `POST /api/input` `{"action":"click"}` followed by `{"action":"down"}` transitioned domain state to `phase=ACTIVE taps=1 focus=1`, invoked `textContainerUpgrade`, and updated the `576×288` RGBA glasses framebuffer (`5,244` lit pixels; buffer diff confirmed).
  - Companion WebView telemetry confirmed `onDeviceStatusChanged` is not emitted in simulator `0.9.5` (`Host Context: n/a / status not emitted`).
  - Outside the Even WebView/simulator (plain browser without `?mock=1`), `waitForEvenAppBridge()` resolves on DOM load and `createStartUpPageContainer` throws `"Flutter handler not available"`, which `apps/device-lab` surfaces explicitly as `BRIDGE FAILED`.
- **Limitation:** Simulator execution proves bridge wiring, SDK serialization, and LVGL framebuffer layout only; it does not prove physical G2 optical comfort, BLE throughput, phone lock/background survival, or real companion-app WebView quirks.
- **Next action:** Automate this flow in M3 (`corepack yarn test:sim`), then execute M4 on physical G2/R1 hardware.

### CAP-006 detail — Event source metadata (`verified-simulator` + `documented` in SDK `0.0.16`)

- **Source:** Installed `@evenrealities/even_hub_sdk@0.0.16` `dist/index.d.ts` + `README.md` changelog, `@evenrealities/evenhub-simulator@0.9.5` `README.md`, and live M2 simulator scroll test (2026-11-14).
- **Findings:**
  - SDK `0.0.15+` fixed `Sys_ItemEvent.fromJson` so `LONG_PRESS_EVENT(9)` and `LONG_PRESS_RELEASE_EVENT(10)` on `sysEvent` preserve `eventSource` (`TOUCH_EVENT_FROM_GLASSES_R = 1`, `TOUCH_EVENT_FROM_RING = 2`, `TOUCH_EVENT_FROM_GLASSES_L = 3`).
  - `Text_ItemEvent` (`textEvent`) and `List_ItemEvent` (`listEvent`) still carry **no `eventSource` field** in SDK `0.0.16`. Live simulator `down` input arrived on `textEvent` (`SCROLL_BOTTOM_EVENT = 2`) and normalized to `source: "unknown"` (`Last: scroll_down (unknown)` on glasses).
  - Protobuf zero-value omission turns `CLICK_EVENT = 0` into `eventType: undefined`; `adapter.ts` normalizes `undefined` on a populated container/sys event to `"tap"` without guessing an origin.
  - Simulator `0.9.5` hardcodes `sysEvent.eventSource = 1` (`glasses-r`).
- **Limitation:** Real R1 ring (`2`) vs left/right temple (`3` / `1`) `eventSource` delivery remains untested on physical firmware.
- **Next action:** Capture raw `EvenHubEvent` samples across left temple, right temple, and R1 ring during M4.

### CAP-012 detail — Microphone audio capture (`documented` in installed SDK `0.0.16`)

- **Source:** `node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts` lines 971–1506 (verified 2026-11-14).
- **Findings:** `bridge.audioControl(isOpen: boolean, source?: AudioInputSource): Promise<boolean>` supports `AudioInputSource.Glasses` (`1`, G2 4-mic array; requires `"g2-microphone"` permission in `app.json` and prior `createStartUpPageContainer` success) and `AudioInputSource.Phone` (`2`, requires `"phone-microphone"` permission). Frames arrive on `event.audioEvent` (`audioPcm: Uint8Array`, `source`, `direction: number | null`, `speakerRole: AudioSpeakerRole`).
- **Limitation:** Not invoked by `apps/device-lab` (`permissions: []`); simulator vs real G2 chunk cadence and battery/BLE impact remain untested.
- **Next action:** Test in an isolated post-M4 audio experiment with explicit user consent and sanitized byte-count logging.

### CAP-013 detail — Native bridge camera & album capture (`documented` in installed SDK `0.0.16`)

- **Source:** `node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts` lines 1019–1520 and `@evenrealities/evenhub-cli@0.2.0` manifest schema (verified 2026-11-14).
- **Findings:** While G2 has no onboard camera, SDK `0.0.16` provides **first-class companion-bridge image capture** without relying on browser `navigator.mediaDevices.getUserMedia` or LAN `HTTPS`:
  - `bridge.captureImageFromCamera(): Promise<AppImageAsset | null>` (requires `"camera"` permission in `app.json`).
  - `bridge.pickImageFromAlbum(): Promise<AppImageAsset | null>` (requires `"album"` permission in `app.json`).
  - `AppImageAsset` delivers `{ path: string, name: string, mimeType: string, size: number, base64?: string }`.
- **Limitation:** Documented in installed SDK types and manifest validator only; simulator and physical phone behavior (`base64` payload size, cancellation return value, G2 foreground continuity while camera UI opens) are untested.
- **Next action:** Validate `captureImageFromCamera()` and `pickImageFromAlbum()` on target phone in a post-M4 vision Q&A experiment.

### CAP-014 detail — Local server-side API proxy for AI/media tools (`proposed`)

- **Source:** `docs/WORKSPACE_BLUEPRINT.md` §3 and §14 (aligned 2026-11-14).
- **Limitation:** Engineering architecture choice; `app.json` `"network"` permission (`whitelist` origins) on the companion app must also be verified when calling a LAN dev proxy from a physical phone.
- **Next action:** Keep M2–M3 zero-backend; introduce only when the first voice/vision/LLM experiment begins.

## Evidence added during M3 & M4 prep (2026-11-14)

### CAP-001, CAP-002, CAP-003, CAP-006, CAP-007, CAP-008 — Repeatable simulator automation & startup telemetry (`verified-simulator`)

- **Source:** `corepack yarn test:sim` (`scripts/sim-harness.mjs`, `scripts/png-inspect.mjs`) against `apps/device-lab` and `@evenrealities/evenhub-simulator@0.9.5` (2026-11-14).
- **Findings:**
  - `GET /api/console?since_id=<N>` in `evenhub-simulator@0.9.5` filters strictly (`id > since_id`, 1-based); callers must pass the last seen `id` rather than `id + 1`.
  - Cold-start non-fatal `bridge.getDeviceInfo()` resolves cleanly in `evenhub-simulator@0.9.5` and populates `Host Context` (`g2 · connected · 100% · worn`) even though `onDeviceStatusChanged` and `onLaunchSource` are not emitted automatically in simulator runs. `sn` is explicitly never stored or surfaced.
  - Across all 6 automated inputs (`click`, `down`, `up`, `long_press`, `long_press_release`, `click`), `[device-lab] STATE` progressed deterministically (`phase`, `taps`, `focus`, `seq`), zero runtime/console errors occurred, and `576×288` RGBA PNG checks confirmed non-zero alpha rendering (`4,913` lit pixels, `160,975` transparent pixels) plus localized framebuffer updates (`1,253`–`6,809` changed pixels). In `0.9.5`, `click` supplied `sysEvent.eventSource=1` (`glasses_right`), whereas `long_press`/`long_press_release` (`eventType: 9`/`10`) arrived without `eventSource` (`unknown`).
- **Limitation:** Still `verified-simulator` only (`0/9` M4 physical device cases run). Physical G2/R1 `eventSource` (`1`/`2`/`3`), `onDeviceStatusChanged`, optical margins, and phone background/lock/offline behaviors await M4 hardware execution via [docs/testing/M4_HARDWARE_RUNBOOK.md](../testing/M4_HARDWARE_RUNBOOK.md).
- **Next action:** Execute the 9 cases in [M4_HARDWARE_RUNBOOK.md](../testing/M4_HARDWARE_RUNBOOK.md) on physical phone + G2 + R1 before marking any capability `verified-device`.

## Evidence added during M4 hardware baseline (2026-11-15)

### CAP-001, CAP-002, CAP-003, CAP-005, CAP-006, CAP-008 — Physical hardware baseline (`verified-device`, `9/9` matrix cases pass)

- **Source:** Manual execution of [M4_HARDWARE_RUNBOOK.md](../testing/M4_HARDWARE_RUNBOOK.md) (`HW-001`–`HW-009` in [TESTING.md](../testing/TESTING.md)) against `apps/device-lab` static preview build (`976de10`) on **2026-11-15**.
- **Tested configuration:** `iPhone 17 Pro Max` / `iOS 27.2`, `Even App v2.4.0`, `Even G2 firmware 2.4.0.24`, `Even R1 firmware 2.3.2.0008`, `@evenrealities/even_hub_sdk@0.0.16`, `vite@8.3.8`.
- **Directly observed hardware behaviors & wire payloads:**
  - **Bridge startup, host telemetry & optical legibility (`CAP-001`, `CAP-002`, `CAP-003`, `CAP-008`):** `Even App v2.4.0` reached `BRIDGE READY`, fired `onLaunchSource("appMenu")`, delivered initial `g2 · connected · 100% · worn`, and emitted live `onDeviceStatusChanged` updates (`100%` -> `99%` during `HW-004`). Operator confirmed the `576×288` border and text render crisply on G2 lenses without clipping.
  - **All three physical `sysEvent.eventSource` values verified (`CAP-005`, `CAP-006`):**
    - Right temple (`glasses_right`, `1`): `{"sysEvent":{"eventSource":1}}` (`#13`)
    - R1 ring (`ring`, `2`): `{"sysEvent":{"eventSource":2}}` (`#1`, `#3`, `#9`), `{"sysEvent":{"eventType":3,"eventSource":2}}` (`#6` double-tap `request_exit`), `{"sysEvent":{"eventType":9,"eventSource":2}}` (`#4`), `{"sysEvent":{"eventType":10,"eventSource":2}}` (`#5`)
    - Left temple (`glasses_left`, `3`): `{"sysEvent":{"eventType":9,"eventSource":3}}` (`#16`), `{"sysEvent":{"eventType":10,"eventSource":3}}` (`#17`)
  - **Confirmed real-firmware protocol quirks (`CAP-006`):**
    - Protobuf omits `CLICK_EVENT = 0` on wire tap payloads (`{"sysEvent":{"eventSource":2}}`, `{"sysEvent":{"eventSource":1}}`), confirming our envelope-first `?? CLICK_EVENT` normalization is required on physical hardware too.
    - `textEvent` scrolls omit `eventSource` on physical hardware even when performed on R1 (`{"textEvent":{"containerID":1,"containerName":"diag-main","eventType":2}}` in `#2` from R1, `#14`/`#15` from temples, `eventType: 1` in `#23`), proving callers must never infer `ring` from omitted sources.
  - **Double-tap exit modal & lifecycle events (`CAP-001`, `CAP-005`):** Double-tap (`eventType: 3` -> `shutDownPageContainer(1)`) opened the Even App's native `"Close this feature?"` modal (`#7` `foreground_enter` / `#8` `foreground_exit` with `eventType: 4` / `5` observed on `sysEvent`); canceling kept SDK listeners active and responsive (`#9` immediately incremented `Taps`).
  - **Resilience checks (`HW-006`–`HW-009`):** Operator verified BLE disconnect (~10s) and reconnect recovery, 15s app-backgrounding with G2 inputs (`foreground_exit`/`foreground_enter` logged in WebView telemetry), 15–20s iOS screen lock/unlock, and ~15s Wi-Fi + Cellular offline operation with Bluetooth on against the static `vite preview` bundle (`HW-009`; already-loaded local plugin loop works offline without HMR errors).
- **Boundaries & remaining unknowns:**
  - Verified on `iOS 27.2` + `Even App v2.4.0` + `G2 2.4.0.24` + `R1 2.3.2.0008` only; **Android**, other iOS versions, and future firmware remain untested.
  - **`CAP-004` stays `verified-simulator`:** `apps/device-lab` uses `containerTotalNum: 1`; multi-container (`2..4`) + mixed `list`/`image`/`text` layout checks on physical G2 await dedicated M6 experiments.
  - **`CAP-011` stays `unknown` overall:** `HW-009` proved the already-loaded static WebView runs without internet, while cold-start offline execution from an installed `.ehpk` package moves to **M5** and full product-workflow offline behavior awaits a selected product.

## Resolved M1 contradictions & tooling records

- **Simulator `0.9.3` vs `0.9.5` contradiction — resolved (2026-11-14):** Installed `node_modules/@evenrealities/evenhub-simulator/README.md` changelog confirms `0.9.0`–`0.9.3` implemented the SDK `0.0.14` surface (`textColor`, `long_press`/`long_press_release`, `context_menu`, Gray4/Gray8 images), `0.9.4` added macOS/Linux ARM64 builds, and `0.9.5` fixed crashes under high-frequency bridge/console traffic. SDK `0.0.15`–`0.0.16` added no new container wire fields (`0.0.15` preserved `sysEvent.eventSource`; `0.0.16` fixed `shadow-timers`), so simulator `0.9.5` matches SDK `0.0.16`'s container and input protocol (subject to `CAP-008`).
- **Project-local Even CLI & simulator — verified (2026-11-14):** `node_modules/.bin/evenhub` (`0.2.0`) and `node_modules/.bin/evenhub-simulator` (`0.9.5`) run directly under pinned Node `24.22.1` (`doctor` reports `[ok] even tooling`), bypassing the broken global mise shims noted in M1.
- **Upstream `everything-evenhub` skill discrepancy recorded (2026-11-14):** Upstream `background-state/SKILL.md` (`cb8321fb`) references `setBackgroundState` and `onBackgroundRestore`, which are **not exported** in `@evenrealities/even_hub_sdk@0.0.16`. Our adapted `.agents/skills/evenhub-input-and-lifecycle/SKILL.md` documents the verified `0.0.16` contract instead.
