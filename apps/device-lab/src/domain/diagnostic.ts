// Application domain for apps/device-lab (blueprint §3 & §9).
// Strictly zero Even SDK imports and zero browser/DOM globals.

export type DiagnosticPhase = "READY" | "ACTIVE";

export type LifecycleStatus = "foreground" | "background" | "closed";

export type InputOrigin =
  "glasses_right" | "glasses_left" | "ring" | "none" | "unknown";

export type DiagnosticCommand =
  | "tap"
  | "scroll_up"
  | "scroll_down"
  | "long_press"
  | "long_press_release"
  | "request_exit"
  | "foreground_enter"
  | "foreground_exit"
  | "session_closed"
  | "menu_select"
  | "audio_frame"
  | "unknown";

export interface NormalizedDeviceInput {
  readonly command: DiagnosticCommand;
  readonly origin: InputOrigin;
  readonly timestampIso: string;
  readonly summary: string;
  readonly rawSanitized: string;
}

export interface DiagnosticEventRecord extends NormalizedDeviceInput {
  readonly seq: number;
}

export const DIAGNOSTIC_PROBES = [
  "Bridge & Display",
  "Input Telemetry",
  "Lifecycle Guard",
] as const;

export const MAX_EVENT_LOG = 20;

export interface DiagnosticState {
  readonly phase: DiagnosticPhase;
  readonly lifecycle: LifecycleStatus;
  readonly tapCount: number;
  readonly scrollUpCount: number;
  readonly scrollDownCount: number;
  readonly focusIndex: number;
  readonly exitPromptPending: boolean;
  readonly nextSeq: number;
  readonly lastInput: DiagnosticEventRecord | null;
  readonly events: readonly DiagnosticEventRecord[];
}

export type AdapterSideEffect =
  "none" | "upgrade_text" | "request_shutdown" | "teardown";

export interface DiagnosticTransition {
  readonly state: DiagnosticState;
  readonly sideEffect: AdapterSideEffect;
}

export function createInitialDiagnosticState(): DiagnosticState {
  return {
    phase: "READY",
    lifecycle: "foreground",
    tapCount: 0,
    scrollUpCount: 0,
    scrollDownCount: 0,
    focusIndex: 0,
    exitPromptPending: false,
    nextSeq: 1,
    lastInput: null,
    events: [],
  };
}

export function clearDiagnosticEventLog(
  state: DiagnosticState,
): DiagnosticState {
  return {
    ...state,
    events: [],
  };
}

export function applyDiagnosticInput(
  state: DiagnosticState,
  input: NormalizedDeviceInput,
): DiagnosticTransition {
  const record: DiagnosticEventRecord = {
    ...input,
    seq: state.nextSeq,
  };
  const events = [record, ...state.events].slice(0, MAX_EVENT_LOG);
  const base: DiagnosticState = {
    ...state,
    nextSeq: state.nextSeq + 1,
    lastInput: record,
    events,
  };

  switch (input.command) {
    case "tap": {
      const tapCount = state.tapCount + 1;
      const phase: DiagnosticPhase = tapCount % 2 === 1 ? "ACTIVE" : "READY";
      return {
        state: {
          ...base,
          tapCount,
          phase,
          exitPromptPending: false,
        },
        sideEffect: "upgrade_text",
      };
    }

    case "scroll_up": {
      const focusIndex = Math.max(0, state.focusIndex - 1);
      return {
        state: {
          ...base,
          scrollUpCount: state.scrollUpCount + 1,
          focusIndex,
          exitPromptPending: false,
        },
        sideEffect: "upgrade_text",
      };
    }

    case "scroll_down": {
      const focusIndex = Math.min(
        DIAGNOSTIC_PROBES.length - 1,
        state.focusIndex + 1,
      );
      return {
        state: {
          ...base,
          scrollDownCount: state.scrollDownCount + 1,
          focusIndex,
          exitPromptPending: false,
        },
        sideEffect: "upgrade_text",
      };
    }

    case "long_press":
    case "long_press_release":
    case "menu_select": {
      return {
        state: {
          ...base,
          exitPromptPending: false,
        },
        sideEffect: "upgrade_text",
      };
    }

    case "request_exit": {
      // Request host exit confirmation without tearing down listeners yet:
      // if the user cancels the system dialog, the plugin must stay responsive.
      return {
        state: {
          ...base,
          exitPromptPending: true,
        },
        sideEffect: "request_shutdown",
      };
    }

    case "foreground_enter": {
      return {
        state: {
          ...base,
          lifecycle: "foreground",
          exitPromptPending: false,
        },
        sideEffect: "upgrade_text",
      };
    }

    case "foreground_exit": {
      return {
        state: {
          ...base,
          lifecycle: "background",
        },
        sideEffect: "none",
      };
    }

    case "session_closed": {
      return {
        state: {
          ...base,
          lifecycle: "closed",
          exitPromptPending: false,
        },
        sideEffect: "teardown",
      };
    }

    case "audio_frame":
    case "unknown": {
      return {
        state: base,
        sideEffect: "none",
      };
    }
  }
}

/**
 * Format text for the single 576x288 G2 text container.
 * Stays well below the 1000-char startup limit (~240 chars, 7 lines * 27px = 189px).
 */
export function formatGlassesScreen(state: DiagnosticState): string {
  const probeLines = DIAGNOSTIC_PROBES.map((label, index) => {
    const marker = index === state.focusIndex ? ">" : " ";
    return `${marker} [${index + 1}] ${label}`;
  }).join("\n");

  const lastSummary = state.lastInput
    ? `${state.lastInput.command} (${state.lastInput.origin})`
    : "none";

  return [
    `EVEN DEV LAB | ${state.phase}`,
    `Taps: ${state.tapCount} | Scroll: ^${state.scrollUpCount} v${state.scrollDownCount}`,
    probeLines,
    `Last: ${lastSummary}`,
    "Tap: step | Swipe: row | 2xTap: exit",
  ].join("\n");
}
