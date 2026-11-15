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

## Hardware matrix — all pending

Nothing below has been run (**0 / 9** cases executed). Follow the step-by-step LAN, QR, and static-preview protocol in [M4_HARDWARE_RUNBOOK.md](M4_HARDWARE_RUNBOOK.md) when physical G2 + R1 + phone hardware is available. Each case records its result in an evidence record when executed (M4); unavailable cases stay **pending**, never pass.

| Case                          | Status  |
| ----------------------------- | ------- |
| Cold start                    | pending |
| Repeated navigation           | pending |
| Long-press / release          | pending |
| Ring absent                   | pending |
| Ring present                  | pending |
| Disconnect / reconnect        | pending |
| Phone foreground / background | pending |
| Screen lock / unlock          | pending |
| Network loss                  | pending |

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
