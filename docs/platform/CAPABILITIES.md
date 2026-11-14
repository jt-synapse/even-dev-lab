# Capability register

Evidence states (blueprint §4): `documented`, `verified-simulator`, `verified-device`, `proposed`, `unknown`, `blocked`, `contradicted`.

Each record must carry a source, access date, applicable versions, evidence state, limitation, and next action. Nothing in this file was executed against a simulator or device during M1 unless the record says so.

## Register inherited from the blueprint

These records are copied from `docs/WORKSPACE_BLUEPRINT.md` §4, which summarizes documentation reviewed on 2026-11-13/14 (source index: blueprint §17). They are **inherited documented claims, not re-verified in M1**. Each must be rechecked against the installed SDK during M2.

| ID      | Statement                                                               | State      | Next action                                     |
| ------- | ----------------------------------------------------------------------- | ---------- | ----------------------------------------------- |
| CAP-001 | Even Hub plugin logic runs in a phone WebView                           | documented | Bridge startup on target phone (M2/M4)          |
| CAP-002 | Glasses UI uses SDK containers rather than browser DOM layout           | documented | Minimal text page (M2)                          |
| CAP-003 | Documented canvas is 576 × 288, monochrome green                        | documented | Confirm in current display docs and SDK (M2)    |
| CAP-004 | Limits of 4 image and 8 other containers; one event-capturing container | documented | Confirm in SDK types and representative layouts |
| CAP-005 | R1 and temple controls supply supported input events                    | documented | Event captures on actual hardware (M4)          |
| CAP-006 | Source info may be absent; long-press events lack `eventSource`         | documented | Check types and hardware payload samples (M4)   |
| CAP-007 | Simulator supports HTTP screenshots, logs, and input injection          | documented | Probe installed simulator endpoints (M2/M3)     |
| CAP-008 | Simulator does not reproduce real BLE timing or all lifecycle behaviour | documented | Keep hardware checks separate                   |
| CAP-009 | Direct generic Bluetooth keyboard-to-G2 pairing is available            | unknown    | No documented support; do not depend on it      |
| CAP-010 | A phone-paired keyboard can supply text to our plugin's WebView         | unknown    | Focus/text/shortcut/lock-state experiment (M6)  |
| CAP-011 | All desired workflows work with no internet                             | unknown    | Controlled offline test matrix                  |

Do not encode a Bluetooth version into application logic: earlier sources disagreed (blueprint §4).

## Evidence added during M1 (2026-11-14)

Newly reviewed sources and executed checks from this milestone. Distinct from the inherited register above.

### Node runtime requirement — documented

- Source: https://hub.evenrealities.com/docs/get-started/quickstart/install-node (page last updated 2026-06-08; accessed 2026-11-14).
- Statement: SDK declares `engines.node = "^20.0.0 || >=22.0.0"`; Node 18 is not supported.
- Applicable versions: SDK 0.0.16 declares the same range in its registry metadata.
- Limitation: an engine range permits, but does not prove, clean operation on Node 24.
- Next action: run the M2 diagnostic toolchain on the pinned Node 24.22.1.

### M2 candidate package versions — documented (registry metadata)

- Source: npm registry metadata, accessed 2026-11-14 (see `COMPATIBILITY.md`).
- `@evenrealities/even_hub_sdk` 0.0.16 (latest; `minAppVersion` 2.2.10), `@evenrealities/evenhub-cli` 0.2.0 (latest), `@evenrealities/evenhub-simulator` 0.9.5 (latest), Vite 8.3.8 (latest).
- Limitation: metadata only. Nothing was installed or run in M1.
- Next action (M2): install as project dependencies at the app level, verify CLIs against `--help` and the installed type definitions before wiring scripts.

### Simulator version in docs vs registry — contradicted

- The tooling docs page (accessed 2026-11-14, page dated 2026-08-29) states simulator “Current version: 0.9.3, tracking SDK 0.0.14”, while the registry's latest simulator is 0.9.5.
- Limitation: unknown whether 0.9.5 tracks SDK 0.0.16 behaviour.
- Next action (M2): check the official changelog and the installed simulator's own reporting; record which SDK surface it emulates before trusting simulator evidence.

### Global Even CLI shims on this machine — blocked (deferred to M2)

- Executed 2026-11-14: `evenhub --version` and `evenhub-simulator --version` resolve to mise shims and fail with “No version is set for shim”. The doctor reports this as `deferred`, never as a foundation failure.
- The official docs install these tools globally via npm. This lab prefers project-controlled versions (blueprint §6.2): install them as recorded devDependencies in M2 instead of repairing global state.
- Next action (M2): project-local install; then re-run doctor-equivalent checks against the local binaries.

### Official agent skills — documented, deferred

- Source: https://github.com/even-realities/everything-evenhub at commit `cb8321fbe2a11d5aaf08fa12088cbe9b9fc5bac2` (2026-10-21, “docs: CLI changes … for CLI 0.2.0”), verified via the GitHub API on 2026-11-14.
- Its README documents Codex CLI support; compatibility with other hosts is unverified. It carries a stale Node prerequisite relative to current docs.
- Decision: do not install in M1. At M2, evaluate HEAD and vendor/adapt useful UI, font-measurement, and simulator skills into `.agents/skills/` so they follow `corepack yarn` and never scaffold or publish outside requested scope.

## Capabilities added during pre-M2 planning alignment (2026-11-14)

Added before starting M2 to track audio, camera/photo Q&A, and API-credential boundaries for planned post-M4 explorations.

| ID      | Statement                                                                                        | State      | Next action                                                            |
| ------- | ------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------- |
| CAP-012 | G2 4-mic array supplies single-stream `16 kHz` PCM audio when explicitly enabled by the plugin   | documented | Verify exact SDK `0.0.16` types in M2; test permissions/stream post-M4 |
| CAP-013 | G2 has no onboard camera; photo Q&A requires phone WebView camera/picker access (`HTTPS` on LAN) | unknown    | Verify `<input capture>` vs `getUserMedia` inside Even WebView post-M4 |
| CAP-014 | Local Node/Vite dev API proxy holds `.env` provider keys server-side, off the client WebView     | proposed   | Keep M2–M3 zero-backend; introduce when first AI/media experiment runs |

### CAP-012 detail — G2 microphone capture (`documented`)

- Source: Even Realities G2 / Even Hub Device APIs documentation (`https://hub.evenrealities.com/docs/build/device-apis`, reviewed 2026-11-14).
- Applicable versions: Even G2 hardware; `@evenrealities/even_hub_sdk` `0.0.16` (to be confirmed against installed `.d.ts` in M2).
- Limitation: Documented only; exact SDK method signature, chunk cadence, permission prompts, and phone lock/background behavior are untested here.
- Next action: Confirm method and payload types in installed SDK `0.0.16` during M2; defer live microphone capture to a dedicated post-M4 experiment with explicit permission/retention rules (blueprint §9, §14).

### CAP-013 detail — Phone-assisted photo capture for G2 Q&A (`unknown`)

- Source: Even Realities G2 product/developer specifications (reviewed 2026-11-14: G2 omits an onboard camera by design) and WebView media security model.
- Applicable versions: Target iOS/Android Even companion app WebView (`minAppVersion` `2.2.10` for SDK `0.0.16`).
- Limitation: Whether the Even companion app's WebView delegates native camera permissions for `navigator.mediaDevices.getUserMedia({ video: true })` (which also requires an `HTTPS` secure context on non-localhost LAN addresses) or file-chooser hooks for `<input type="file" accept="image/*" capture="environment">` is `unknown`.
- Next action: Test photo picker vs live camera stream in an isolated experiment after the M4 hardware baseline, without disrupting G2 bridge/BLE state.

### CAP-014 detail — Local server-side API proxy for AI/media tools (`proposed`)

- Source: `docs/WORKSPACE_BLUEPRINT.md` §3 and §14 (engineering decision aligned 2026-11-14).
- Applicable versions: Workspace architecture (post-M3 explorations).
- Limitation: Engineering design choice, not an external platform capability. Phone reachability, LAN firewall rules, CORS, and `HTTPS` termination (if paired with CAP-013) must be validated per host network.
- Next action: Keep M2–M3 strictly zero-backend; introduce a minimal provider-neutral local Node/Vite proxy reading server-side `.env` credentials only when the first AI, voice, or vision experiment begins.
