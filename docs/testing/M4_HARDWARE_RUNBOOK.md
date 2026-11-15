# M4 Hardware Baseline Runbook

Use this runbook to execute the physical Even Realities **G2 glasses + R1 ring + companion phone app** baseline (`M4`) against `apps/device-lab`.

> [!IMPORTANT]
> Local simulator passes (`corepack yarn test:sim`) establish `verified-simulator` only. Do **not** change any matrix status in `docs/testing/TESTING.md` from `pending` or any capability in `docs/platform/CAPABILITIES.md` to `verified-device` until JT runs these checks on physical hardware and records the observations.

## 1. Record hardware & app metadata first

Before running case 1, capture the exact device baseline for the Evidence Record template in [TESTING.md](TESTING.md):

- Commit SHA tested (`git rev-parse --short HEAD`)
- Phone model and OS version (iOS / Android)
- Even app version (target `>= 2.2.10` per `docs/planning/OPEN_QUESTIONS.md`)
- G2 firmware version and battery state
- R1 ring firmware version and battery state (note whether paired/worn)
- Host toolchain pinned versions (`corepack yarn doctor` -> Node `24.22.1`, Yarn `4.18.1`, `@evenrealities/even_hub_sdk@0.0.16`)

Never record device serial numbers (`sn`), tokens, or account IDs into git-tracked docs; keep raw exports/screenshots under gitignored `artifacts/hw/<YYYY-MM-DD>/`.

## 2. LAN & QR sideload setup

Confirm phone and Mac are on the same LAN / hotspot and phone can reach the Mac's LAN IP (never commit personal LAN IPs or auth tokens).

### Standard cases (matrix cases 1–8)

1. Start the LAN dev server on the Mac:
   ```bash
   DEV_HOST=0.0.0.0 corepack yarn dev:lab
   ```
2. In another terminal, print the local QR code for your explicit Mac LAN IP (no Even account login or upload):
   ```bash
   corepack yarn qr:lab --url http://<lan-ip>:5173
   ```
3. Scan the QR code inside the Even companion app developer launcher to open `apps/device-lab` inside the phone WebView.

### Offline / static bundle setup (required for case 9: `Network loss`)

`dev:lab` runs Vite's HMR WebSocket client, which fires disconnect/reconnect traffic when Wi-Fi drops. For `Network loss`, serve the built static bundle with `preview:lab` instead:

```bash
corepack yarn build
DEV_HOST=0.0.0.0 corepack yarn preview:lab
corepack yarn qr:lab --url http://<lan-ip>:4173
```

## 3. What to observe in `apps/device-lab`

- **Phone WebView header badge:** transitions from `CONNECTING` to `BRIDGE READY` (failures display `BRIDGE ERROR` with the thrown message).
- **Phone `Host Context` cell:** displays `launchSource` (`appMenu`, `glassesMenu`, or `n/a`) and `deviceStatus` summary (`model · connectType · battery% · worn/not-worn · charging · in-case`), seeded best-effort via `bridge.getDeviceInfo()` on startup and updated live by `onDeviceStatusChanged`. Device `sn` is intentionally never stored or rendered.
- **G2 `576×288` HUD container:** renders the header (`EVEN DEV LAB | READY` / `ACTIVE`), counters (`Taps: N | Scroll: ^U vD`), three focusable probe rows (`[1] Bridge & Display`, `[2] Input Telemetry`, `[3] Lifecycle Guard`), `Last: <command> (<origin>)`, and footer hint (`Tap: step | Swipe: row | 2xTap: exit`).
- **Phone `Normalized Input Log`:** keeps the 20 newest events (`#seq · <envelope> <command> via <origin>`) with sanitized JSON keys. Check whether real hardware emits `eventSource` (`1` = `glasses_right`, `2` = `ring`, `3` = `glasses_left`) on taps/scrolls as well as `long_press` / `long_press_release`.

## 4. Hardware matrix — 9 pending cases

Execute in order and log an Evidence Record per case. Keep all results strictly factual.

### 1. Cold start

- **Setup:** G2 powered on and worn; Even app freshly launched; phone connected to Mac LAN URL via QR.
- **Steps:** Launch `apps/device-lab` from the scanned QR / app menu and observe without touching controls for 5s.
- **Expected:**
  - Phone shows `BRIDGE READY` without timeout/error banner.
  - `Host Context` captures initial `launchSource` and `getDeviceInfo()` / `onDeviceStatusChanged()` telemetry (`g2`, connection state, battery, wearing flag).
  - G2 renders cleanly inside `576×288` bounds with crisp outer border, 8px padding, and readable contrast/optical margins (`CAP-001`, `CAP-002`, `CAP-003`).
- **Record:** Optical legibility notes (edge clipping, flicker, contrast indoors/outdoors), time to first G2 render, and exact `Host Context` fields populated.

### 2. Repeated navigation

- **Setup:** From `Cold start` ready state.
- **Steps:**
  1. Perform 10 alternating scroll-down and scroll-up gestures on right temple, then left temple (20+ total scroll events).
  2. Perform 5 single taps, checking focus clamping at Row 1 and Row 3 and `READY` <-> `ACTIVE` toggling.
  3. Trigger double-tap (`DOUBLE_CLICK_EVENT` -> `request_exit`); if host prompts for exit confirmation, **cancel** the exit prompt and tap/scroll again; finally confirm exit or close cleanly and relaunch once.
- **Expected:**
  - Focus clamps cleanly (`[1]` .. `[3]`), counters never drift, and `textContainerUpgrade` stays responsive without queued lag (`CAP-002`, `CAP-005`).
  - Canceling exit confirmation leaves session `BRIDGE READY` and subsequent taps/scrolls still update G2 HUD (guards premature listener teardown).
- **Record:** Perceived BLE latency per `textContainerUpgrade`, any dropped/duplicated swipes, and actual `origin` values logged for right vs left temple taps/swipes.

### 3. Long-press / release

- **Setup:** Session `BRIDGE READY` with G2 worn and R1 paired (or test per connected input device).
- **Steps:**
  1. Press and hold right G2 temple (`LONG_PRESS_EVENT`), hold ~1s, then release (`LONG_PRESS_RELEASE_EVENT`).
  2. Repeat on left G2 temple.
  3. Repeat on R1 ring.
- **Expected:**
  - `Normalized Input Log` records `sys long_press` followed by `sys long_press_release` (`eventType: 9` and `10`), and G2 `Last:` line updates immediately on both press and release.
  - Check whether `eventSource` resolves to `glasses_right` (`1`), `glasses_left` (`3`), and `ring` (`2`) (`CAP-006`).
- **Record:** Exact sanitized JSON logged for all three physical sources (do they populate `eventSource`, or omit any fields?).

### 4. Ring absent

- **Setup:** Unpair, power off, or leave R1 ring out of BLE range/in charging dock so only G2 + phone are active.
- **Steps:** Launch `apps/device-lab`, perform taps/swipes/long-press on G2 left and right temples.
- **Expected:**
  - App starts cleanly without errors waiting for R1.
  - Events originating from temples never misreport `ring`, and missing `eventSource` normalizes to `unknown` (`CAP-006`, `CAP-008`).
- **Record:** `Host Context` telemetry and sanitized raw events.

### 5. Ring present

- **Setup:** R1 ring worn and connected in the Even app alongside G2.
- **Steps:** Perform tap, scroll up/down, double-tap (cancel exit), and long-press/release using **only the R1 ring**, then follow immediately with a right-temple tap.
- **Expected:**
  - R1 ring drives state transitions identically to temple controls (`CAP-005`).
  - Observe which R1 gestures populate `eventSource: 2` (`ring`) vs omit `eventSource` (`unknown`) (`CAP-006`).
- **Record:** Every R1 gesture payload and latency comparison vs G2 temple input.

### 6. Disconnect / reconnect

- **Setup:** Active `BRIDGE READY` session with G2 on head.
- **Steps:**
  1. Disable Bluetooth on phone OR place G2 into charging case / out of BLE range for ~10s while keeping `apps/device-lab` open on phone.
  2. Re-enable Bluetooth / take G2 out of case and wait up to 30s, then tap once on G2.
- **Expected:**
  - Observe `Host Context` (`onDeviceStatusChanged` `disconnected` / `isInCase` -> `connected`) and any lifecycle/error events emitted by the host.
  - Document whether G2 HUD recovers automatically after reconnect or requires manual re-entry (`CAP-001`, `CAP-008`).
- **Record:** Exact status transitions and whether `textContainerUpgrade` resumes without re-scanning QR.

### 7. Phone foreground / background

- **Setup:** Active `BRIDGE READY` session.
- **Steps:**
  1. Switch phone to another app (background Even app) for 15–30s; perform 2 taps and 1 scroll on G2 while phone is backgrounded.
  2. Return Even app to foreground and inspect both G2 HUD and phone `Normalized Input Log` (check for `foreground_exit` / `foreground_enter`).
- **Expected:**
  - Record whether `FOREGROUND_EXIT_EVENT` (`lifecycle=background`) and `FOREGROUND_ENTER_EVENT` (`lifecycle=foreground`) fire, and whether G2 inputs continue updating the HUD while Even app is backgrounded.
- **Record:** Any OS throttling (iOS vs Android), missed updates, or delayed upgrades.

### 8. Screen lock / unlock

- **Setup:** Active `BRIDGE READY` session.
- **Steps:**
  1. Lock phone screen for ~30s; perform 2 taps and 1 scroll on G2 while phone is locked.
  2. Unlock phone back into Even app and inspect G2 HUD + phone log.
- **Expected:**
  - Document whether JS execution / `textContainerUpgrade` continues while screen is locked or pauses until unlock, and verify clean recovery with zero bridge errors after unlock.
- **Record:** Lock-state behavior and any `BRIDGE ERROR` / disconnect observed.

### 9. Network loss

- **Setup:** Build and launch via static `preview:lab` (`DEV_HOST=0.0.0.0 corepack yarn preview:lab`, port `4173`, **not** `dev:lab` HMR) and load on phone over QR.
- **Steps:**
  1. Confirm `BRIDGE READY` and perform 1 tap (`Taps: 1`).
  2. Enable Airplane Mode on phone (or turn off Wi-Fi + cellular data so phone has zero internet and zero LAN access while keeping Bluetooth on if testing pure BLE + local WebView, or toggle Wi-Fi only first).
  3. Perform taps, scrolls, and long-press on G2/R1 for 15–30s while offline.
  4. Restore Wi-Fi / network and perform 1 more tap.
- **Expected:**
  - Already-loaded `apps/device-lab` WebView continues driving G2 updates purely locally over BLE/bridge without remote network calls (`CAP-011` local plugin loop).
  - Verify whether Even companion app itself forces a reload or disconnects WebView when Wi-Fi drops.
- **Record:** Both Wi-Fi-off (BLE still on) and full Airplane-Mode behaviors.

## 5. Completing M4

After all 9 cases run on physical hardware:

1. Add completed Evidence Records (or attach links to `artifacts/hw/...` without committing artifacts) and update the status table in [TESTING.md](TESTING.md).
2. Promote only directly observed capabilities to `verified-device` in [CAPABILITIES.md](../platform/CAPABILITIES.md) with phone OS, Even app version, and G2/R1 firmware listed.
3. Update [STATUS.md](../planning/STATUS.md) to close **M4 (Hardware baseline)** and prepare **M5 (Validation + GitHub CI)**.
