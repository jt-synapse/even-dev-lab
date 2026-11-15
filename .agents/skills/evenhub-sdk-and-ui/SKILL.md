---
name: evenhub-sdk-and-ui
description: Build G2 576x288 container layouts, LVGL text sizing, phone-side WebView UI, and device feature calls with @evenrealities/even_hub_sdk 0.0.16. Use when authoring or reviewing Even integration adapters, glasses UI containers, font/container dimensions, audio capture, or phone camera/album calls.
---

# Even Hub SDK 0.0.16 & Glasses UI Reference

> Adapted for `even-dev-lab` from `even-realities/everything-evenhub` (`cb8321fbe2a11d5aaf08fa12088cbe9b9fc5bac2`, MIT License) and verified against installed `@evenrealities/even_hub_sdk@0.0.16` (`dist/index.d.ts`).
>
> **Workspace boundary rule:** Only the Even integration layer (e.g., `src/even/*`) may import `@evenrealities/even_hub_sdk`. Domain modules (`src/domain/*`) must never import SDK or browser globals. Always add dependencies per package using `corepack yarn`, never `npm`.

## Required Startup Call Order

1. `const bridge = await waitForEvenAppBridge()` — wrap in a bounded timeout; note that in a plain desktop browser (outside `evenhub-simulator` or the Even companion app), `waitForEvenAppBridge()` resolves on DOM ready and subsequent native calls throw `"Flutter handler not available"`.
2. `const res = await bridge.createStartUpPageContainer(payload)` — call **at most once** per session. Check `res === StartUpPageCreateResult.success` (`0`). Codes: `0` = success, `1` = invalid, `2` = oversize, `3` = outOfMemory.
3. Subsequent updates:
   - In-place text (flicker-free, up to 2000 chars): `await bridge.textContainerUpgrade(...)` (`containerID` and `containerName` must match startup exactly).
   - Structural layout or list updates (up to 1000 chars per text container): `await bridge.rebuildPageContainer(...)`.
   - Serialize all bridge calls through a single async queue; never send concurrent `updateImageRawData`, render, or storage writes over BLE.

## 576×288 Canvas & Container Limits

- **Canvas:** `576 × 288` px, origin `(0, 0)` top-left, 4-bit greyscale (`0` = transparent/off, `15` = bright green on hardware).
- **Per-page limits:** `containerTotalNum` `1..12` total; max `8` text/list containers; max `4` image containers (`width` `20..288`, `height` `20..144`).
- **Event capture:** Exactly **one** text or list container per page must set `isEventCapture: 1` (image containers cannot capture events; place a space-filled `content: " "` text container behind an image when needed).
- **Identifiers:** Unique `containerID` (integer) and `containerName` (max 16 chars) per page.
- **`zOrderIndex` (all-or-nothing):** Either every list/text/image container on a page sets a unique `zOrderIndex` (larger = front) or **none** do. Validate locally with `validateEvenHubPageContainer(container)` if mixing layers.
- **`textColor` (`0..4`):** Optional integer brightness level (`MIN_TEXT_BRIGHTNESS = 0`, `MAX_TEXT_BRIGHTNESS = 4`). Omit on startup/rebuild for firmware default `4`; values outside `0..4` are rejected by the SDK.
- **Contextual menu (`menuObject`):** Optional `MenuContainerProperty` with up to `10` `MenuItemProperty` entries (`itemID`: unique non-zero uint32; `itemName`: max 32 UTF-8 bytes). Omitting `menuObject` on `rebuildPageContainer` clears any custom menu.

## LVGL Text & Container Sizing

- Firmware renders a single proportional LVGL font: **line height = `27px`**, **list item height = `40px`**.
- `borderWidth` (`0..5`) and `paddingLength` (`0..32`) both inset **inside** container `width` and `height`:
  - `innerWidth = width - 2 * (paddingLength + borderWidth)`
  - `innerHeight = height - 2 * (paddingLength + borderWidth)`
  - `maxVisibleLines = Math.floor(innerHeight / 27)`
- For pixel-exact wrapping before adding `@evenrealities/pretext` (only add as a pinned package dependency when needed), subtract `2 * (paddingLength + borderWidth)` first.

## Hardware & Phone Capabilities in SDK `0.0.16`

- **Audio (`bridge.audioControl(isOpen, source?)`):**
  - `AudioInputSource.Glasses` (`"glasses"`, default): G2 4-mic array (`16 kHz` signed 16-bit LE mono PCM on `event.audioEvent.audioPcm`, plus `direction: number | null` and `speakerRole: AudioSpeakerRole`). Requires `createStartUpPageContainer` to succeed first and `"g2-microphone"` in `app.json` permissions.
  - `AudioInputSource.Phone` (`"phone"`): phone mic (`"phone-microphone"` permission; no startup-page prerequisite).
- **Phone Photos (`bridge.captureImageFromCamera()` / `bridge.pickImageFromAlbum()`):**
  - G2 glasses have **no onboard camera**. Both methods use the connected phone (`"camera"` / `"album"` permissions in `app.json`) and resolve to `AppImageAsset | null` (`{ path, name, mimeType, size, base64 }`). Downscale to `<= 288×144` before sending any image to G2 via `updateImageRawData`.
- **Persistence (`bridge.setLocalStorage(key, value)` / `bridge.getLocalStorage(key)`):**
  - Use SDK storage rather than `window.localStorage` / `IndexedDB`, which are unreliable across Flutter WebView restarts.

## Phone WebView Styling Tokens

- Dark surface tokens: background `#111111`, card `#1A1A1A`, primary text `#FFFFFF`, secondary `#8A8A8A`, accent `#FEF991` (sparingly on buttons/badges). Never use glasses `#3CFA44` green as phone UI chrome.
