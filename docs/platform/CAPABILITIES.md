# Capability register

Evidence states (blueprint §4): `documented`, `verified-simulator`, `verified-device`, `proposed`, `unknown`, `blocked`, `contradicted`.

Each record carries a source, date, applicable versions, evidence state, limitation, and next action. Simulator runs establish `verified-simulator` only — **never** `verified-device`. Physical G2/R1 hardware checks remain **not run** until M4.

## Core platform capability summary

| ID      | Statement                                                                                        | State              | Next action                                                               |
| ------- | ------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------- |
| CAP-001 | Even Hub plugin logic runs in a companion WebView (`WKWebView` in macOS simulator)               | verified-simulator | Verify bridge startup in target phone Even app WebView (M4)               |
| CAP-002 | Glasses UI uses SDK containers (`createStartUpPageContainer`, `textContainerUpgrade`)            | verified-simulator | Verify container startup & upgrade latency on physical G2 (M4)            |
| CAP-003 | Glasses framebuffer is `576 × 288` monochrome green (RGBA PNG with 4-bit alpha intensity in sim) | verified-simulator | Verify visual legibility & optical margins on physical G2 lenses (M4)     |
| CAP-004 | Container limits (`<= 4` total per page; 1 `isEventCapture: 1` container) enforced by SDK/sim    | verified-simulator | Verify representative multi-container layouts on physical G2 (M4)         |
| CAP-005 | R1 ring and G2 temple controls supply tap, double-tap, scroll, and long-press events             | documented         | Capture real hardware event streams from both temples and R1 ring (M4)    |
| CAP-006 | `textEvent`/`listEvent` omit `eventSource`; `sysEvent` preserves it on long-press since `0.0.15` | verified-simulator | Verify real `eventSource` (`1`, `2`, `3`) payloads on G2 + R1 (M4)        |
| CAP-007 | Simulator `0.9.5` provides HTTP `/api/ping`, `/api/console`, `/api/input`, `/api/screenshot/*`   | verified-simulator | Promote into repeatable `corepack yarn test:sim` suite (M3)               |
| CAP-008 | Simulator omits `onDeviceStatusChanged`, hardcodes `sysEvent.eventSource=1`, no real BLE timing  | verified-simulator | Keep M4 hardware matrix mandatory and distinct from simulator checks      |
| CAP-009 | Direct generic Bluetooth keyboard-to-G2 pairing is available                                     | unknown            | No documented support; do not depend on it                                |
| CAP-010 | A phone-paired keyboard can supply text to our plugin's WebView                                  | unknown            | Focus/text/shortcut/lock-state experiment on target phone (M6)            |
| CAP-011 | All desired workflows work with no internet                                                      | unknown            | Controlled offline test matrix once a concrete workflow exists            |
| CAP-012 | `bridge.audioControl(isOpen, AudioInputSource)` streams `16 kHz` PCM (`AudioEvent.audioPcm`)     | documented         | Exercise permission & stream lifecycle in dedicated post-M4 experiment    |
| CAP-013 | `bridge.captureImageFromCamera()` / `pickImageFromAlbum()` return native `AppImageAsset \| null` | documented         | Verify native camera/album bridge prompts & payload size on phone post-M4 |
| CAP-014 | Local Node/Vite dev API proxy holds `.env` provider keys server-side, off the client WebView     | proposed           | Keep M2–M3 zero-backend; introduce when first AI/media experiment starts  |

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

## Resolved M1 contradictions & tooling records

- **Simulator `0.9.3` vs `0.9.5` contradiction — resolved (2026-11-14):** Installed `node_modules/@evenrealities/evenhub-simulator/README.md` changelog confirms `0.9.0`–`0.9.3` implemented the SDK `0.0.14` surface (`textColor`, `long_press`/`long_press_release`, `context_menu`, Gray4/Gray8 images), `0.9.4` added macOS/Linux ARM64 builds, and `0.9.5` fixed crashes under high-frequency bridge/console traffic. SDK `0.0.15`–`0.0.16` added no new container wire fields (`0.0.15` preserved `sysEvent.eventSource`; `0.0.16` fixed `shadow-timers`), so simulator `0.9.5` matches SDK `0.0.16`'s container and input protocol (subject to `CAP-008`).
- **Project-local Even CLI & simulator — verified (2026-11-14):** `node_modules/.bin/evenhub` (`0.2.0`) and `node_modules/.bin/evenhub-simulator` (`0.9.5`) run directly under pinned Node `24.22.1` (`doctor` reports `[ok] even tooling`), bypassing the broken global mise shims noted in M1.
- **Upstream `everything-evenhub` skill discrepancy recorded (2026-11-14):** Upstream `background-state/SKILL.md` (`cb8321fb`) references `setBackgroundState` and `onBackgroundRestore`, which are **not exported** in `@evenrealities/even_hub_sdk@0.0.16`. Our adapted `.agents/skills/evenhub-input-and-lifecycle/SKILL.md` documents the verified `0.0.16` contract instead.
