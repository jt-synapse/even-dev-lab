---
name: evenhub-simulator
description: Launch and automate the project-local EvenHub simulator (0.9.5) via HTTP endpoints for health checks, console polling, input injection, and RGBA screenshot verification. Use when running or scripting simulator checks.
---

# EvenHub Simulator (0.9.5) & HTTP Automation

> Adapted for `even-dev-lab` from `even-realities/everything-evenhub` (`cb8321fbe2a11d5aaf08fa12088cbe9b9fc5bac2`, MIT License) and verified against installed `@evenrealities/evenhub-simulator@0.9.5`.

## Workspace Invocation Rules

- Always run the **project-local** binary (`node_modules/.bin/evenhub-simulator` or `corepack yarn sim:lab`), never an unpinned global install.
- Simulator evidence is recorded as `verified-simulator` in `docs/platform/CAPABILITIES.md` — **never** promote simulator results to `verified-device`.
- Always clean up every child process (`vite` and `evenhub-simulator`) started by a harness; never kill unrelated processes on a busy port.

## Launching with Automation HTTP API

```sh
corepack yarn sim:lab --automation-port 9898
```

Base URL: `http://127.0.0.1:9898` (keep loopback-only; never expose publicly).

## Verified Endpoints (`0.9.5`)

| Method   | Endpoint                  | Contract                                                                                                                                                        |
| -------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/ping`               | Returns `pong`.                                                                                                                                                 |
| `GET`    | `/api/console`            | Returns `{ entries: [{ id, level, message, ts }], total }`. Supports `?since_id=<nonNegativeInt>` (returns `id > since_id`; pass last seen `id`, not `id + 1`). |
| `DELETE` | `/api/console`            | Clears buffered console entries (poll for `APP_READY` **before** clearing so startup logs are not lost).                                                        |
| `GET`    | `/api/screenshot/glasses` | `576×288` RGBA PNG of the LVGL framebuffer.                                                                                                                     |
| `GET`    | `/api/screenshot/webview` | PNG snapshot of the companion WebView (`WKWebView` on macOS).                                                                                                   |
| `POST`   | `/api/input`              | JSON `{ "action": "up" \| "down" \| "click" \| "double_click" \| "long_press" \| "long_press_release" \| "context_menu" }`.                                     |

## Critical Screenshot Rule (RGBA Alpha Channel)

- Unlit background pixels in `/api/screenshot/glasses` are `(R=0, G=255, B=0, A=0)` and lit pixels have `A > 0` (4-bit alpha/intensity).
- **Never strip the alpha channel** (converting RGBA → RGB turns the entire canvas solid green). Always inspect the alpha channel (`A > 0`) alongside state/console assertions, and save test artifacts under `artifacts/` (gitignored).

## Known Simulator vs. Real G2/R1 Differences

- `onDeviceStatusChanged` is **not** emitted in simulator `0.9.5`.
- `sysEvent.eventSource` is `1` (`TOUCH_EVENT_FROM_GLASSES_R`) on `click` in `0.9.5`, and omitted (`origin=unknown`) on `long_press` / `long_press_release`; R1 ring (`2`) and left-temple (`3`) origin discrimination requires M4 hardware testing.
- `imuData` is always `null`.
- BLE latency, packet contention, and phone lock/background lifecycle are not reproduced.
