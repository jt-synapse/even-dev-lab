---
name: evenhub-input-and-lifecycle
description: Route G2 temple and R1 ring input events, handle protobuf zero-value omission, preserve eventSource safely, and manage page exit/teardown in @evenrealities/even_hub_sdk 0.0.16. Use when writing or testing EvenHubEvent handlers and lifecycle cleanup.
---

# Even Hub Input Routing & Lifecycle (SDK 0.0.16)

> Adapted for `even-dev-lab` from `even-realities/everything-evenhub` (`cb8321fbe2a11d5aaf08fa12088cbe9b9fc5bac2`, MIT License) and verified against installed `@evenrealities/even_hub_sdk@0.0.16` (`dist/index.d.ts`).

## Critical Wire & Routing Rules

1. **Protobuf zero-value omission (`CLICK_EVENT === 0`):**
   - `OsEventTypeList.CLICK_EVENT` is `0` and `listEvent.currentSelectItemIndex` for the first item is `0`. On the wire, protobuf omits `0` fields so they arrive as `undefined`.
   - **Always check envelope presence first**, then apply nullish coalescing _inside_ that branch:
     ```ts
     if (event.sysEvent) {
       const type = event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
     }
     ```
   - Never write `event.sysEvent?.eventType ?? OsEventTypeList.CLICK_EVENT` at the top level — that misclassifies every `textEvent`, `listEvent`, and `audioEvent` as a click!

2. **Container-dependent gesture routing:**
   - **Text container (`isEventCapture: 1`):**
     - Swipe up/down → `event.textEvent` (`SCROLL_TOP_EVENT = 1`, `SCROLL_BOTTOM_EVENT = 2`).
     - Tap / double-tap / long-press / release → `event.sysEvent` (`CLICK_EVENT = 0/undefined`, `DOUBLE_CLICK_EVENT = 3`, `LONG_PRESS_EVENT = 9`, `LONG_PRESS_RELEASE_EVENT = 10`).
   - **List container (`isEventCapture: 1`):**
     - Swipe up/down is handled natively by firmware (no JS event needed).
     - Item tap → `event.listEvent` (`currentSelectItemIndex ?? 0`).
     - Double-tap → `event.sysEvent` (`DOUBLE_CLICK_EVENT = 3`).
   - **Contextual menu item click:** `event.menuItemClickEvent` (`itemID`).

3. **`eventSource` Origin Handling (`EventSourceType`):**
   - `0` = `TOUCH_EVENT_FORM_DUMMY_NULL`
   - `1` = `TOUCH_EVENT_FROM_GLASSES_R` (simulator `0.9.5` hardcodes `1` on `sysEvent`)
   - `2` = `TOUCH_EVENT_FROM_RING` (R1 ring)
   - `3` = `TOUCH_EVENT_FROM_GLASSES_L`
   - Since SDK `0.0.15+`, `sysEvent` preserves `eventSource` on `CLICK`, `DOUBLE_CLICK`, `LONG_PRESS`, and `LONG_PRESS_RELEASE`. However, `textEvent` and `listEvent` carry no `eventSource`, and older hosts may omit it. **Always treat `undefined` as `"unknown"` — never infer `"ring"` from a missing `eventSource`.**

## Exit & Teardown Contract

- **Double-tap exit confirmation:** On `DOUBLE_CLICK_EVENT (3)`, call `await bridge.shutDownPageContainer(1)` and **keep listeners active** — if the user cancels the host exit dialog, the app remains open and must still receive input.
- **Actual teardown:** Unsubscribe listeners (`onEvenHubEvent`, `onLaunchSource`, `onDeviceStatusChanged`, `onAppLocationChanged`) and stop active hardware (`audioControl(false)`, `imuControl(false)`, `stopAppLocationUpdates()`) on:
  - `OsEventTypeList.SYSTEM_EXIT_EVENT (7)` or `OsEventTypeList.ABNORMAL_EXIT_EVENT (6)`
  - WebView `pagehide` / `beforeunload` / HMR `import.meta.hot.dispose`
- **SDK `0.0.16` note:** Upstream skill docs mention `setBackgroundState` / `onBackgroundRestore`, which are **not exported** in `@evenrealities/even_hub_sdk@0.0.16`. Persist durable state via `bridge.setLocalStorage` / `bridge.getLocalStorage` (debounced) and handle `FOREGROUND_EXIT_EVENT (5)` / `FOREGROUND_ENTER_EVENT (4)` explicitly.
