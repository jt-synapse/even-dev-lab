import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_EVENT_LOG,
  applyDiagnosticInput,
  clearDiagnosticEventLog,
  createInitialDiagnosticState,
  formatGlassesScreen,
  type NormalizedDeviceInput,
} from "../src/domain/diagnostic.ts";

function makeInput(
  overrides: Partial<NormalizedDeviceInput> = {},
): NormalizedDeviceInput {
  return {
    command: "tap",
    origin: "glasses_right",
    timestampIso: "2026-11-14T20:00:00.000Z",
    summary: "sys tap via glasses_right",
    rawSanitized: '{"sysEvent":{}}',
    ...overrides,
  };
}

test("tap produces deterministic phase and counter transition", () => {
  const s0 = createInitialDiagnosticState();
  assert.equal(s0.phase, "READY");
  assert.equal(s0.tapCount, 0);
  assert.match(formatGlassesScreen(s0), /EVEN DEV LAB \| READY/);

  const t1 = applyDiagnosticInput(s0, makeInput({ command: "tap" }));
  assert.equal(t1.sideEffect, "upgrade_text");
  assert.equal(t1.state.phase, "ACTIVE");
  assert.equal(t1.state.tapCount, 1);
  assert.match(formatGlassesScreen(t1.state), /EVEN DEV LAB \| ACTIVE/);
  assert.match(formatGlassesScreen(t1.state), /Taps: 1/);

  const t2 = applyDiagnosticInput(t1.state, makeInput({ command: "tap" }));
  assert.equal(t2.state.phase, "READY");
  assert.equal(t2.state.tapCount, 2);
});

test("scroll up and down clamp focus within probe rows", () => {
  let state = createInitialDiagnosticState();
  state = applyDiagnosticInput(
    state,
    makeInput({ command: "scroll_up" }),
  ).state;
  assert.equal(state.focusIndex, 0);
  assert.equal(state.scrollUpCount, 1);

  state = applyDiagnosticInput(
    state,
    makeInput({ command: "scroll_down" }),
  ).state;
  state = applyDiagnosticInput(
    state,
    makeInput({ command: "scroll_down" }),
  ).state;
  state = applyDiagnosticInput(
    state,
    makeInput({ command: "scroll_down" }),
  ).state;
  assert.equal(state.focusIndex, 2);
  assert.equal(state.scrollDownCount, 3);
  assert.match(formatGlassesScreen(state), /> \[3\] Lifecycle Guard/);
});

test("double-tap requests shutdown without tearing down session prematurely", () => {
  const s0 = createInitialDiagnosticState();
  const exitReq = applyDiagnosticInput(
    s0,
    makeInput({ command: "request_exit" }),
  );
  assert.equal(exitReq.sideEffect, "request_shutdown");
  assert.equal(exitReq.state.exitPromptPending, true);
  assert.equal(exitReq.state.lifecycle, "foreground");

  // If the user cancels the dialog and taps again, state keeps advancing cleanly.
  const resumed = applyDiagnosticInput(
    exitReq.state,
    makeInput({ command: "tap" }),
  );
  assert.equal(resumed.state.exitPromptPending, false);
  assert.equal(resumed.state.tapCount, 1);

  // Confirming system exit triggers teardown.
  const closed = applyDiagnosticInput(
    resumed.state,
    makeInput({ command: "session_closed" }),
  );
  assert.equal(closed.sideEffect, "teardown");
  assert.equal(closed.state.lifecycle, "closed");
});

test("event log stays bounded to MAX_EVENT_LOG and supports clearing", () => {
  let state = createInitialDiagnosticState();
  for (let i = 0; i < MAX_EVENT_LOG + 5; i += 1) {
    state = applyDiagnosticInput(state, makeInput()).state;
  }
  assert.equal(state.events.length, MAX_EVENT_LOG);
  assert.equal(state.events[0]?.seq, MAX_EVENT_LOG + 5);

  const cleared = clearDiagnosticEventLog(state);
  assert.equal(cleared.events.length, 0);
  assert.equal(cleared.tapCount, MAX_EVENT_LOG + 5);
});
