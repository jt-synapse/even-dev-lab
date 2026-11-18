// Pure Cadence AI Interview Copilot state machine & 576x288 G2 teleprompter formatter.
// Zero SDK, DOM, or Node globals (enforced by eslint.config.mjs).

export type CadencePhase =
  | "IDLE"
  | "LISTENING"
  | "TRANSCRIBING"
  | "CAPTURING_PHOTO"
  | "THINKING"
  | "ANSWER_READY"
  | "ERROR";

export type SessionLifecycle = "foreground" | "background" | "closed";

export type AudioSourceMode = "g2-mic" | "phone-mic" | "mac-mic";

export type GroundingMode = "kb" | "general";

export type AnswerTriggerKind = "voice" | "webcam" | "text";

export type InputOrigin =
  "none" | "glasses_right" | "ring" | "glasses_left" | "unknown" | "ui";

export type CadenceCommand =
  | "ring_hold_start"
  | "ring_hold_release"
  | "trigger_webcam_capture"
  | "cycle_audio_source"
  | "clear_answer"
  | "scroll_up"
  | "scroll_down"
  | "request_exit"
  | "foreground_enter"
  | "foreground_exit"
  | "session_closed"
  | "audio_chunk_received"
  | "unknown";

export interface NormalizedCadenceInput {
  readonly command: CadenceCommand;
  readonly origin: InputOrigin;
  readonly timestampIso: string;
  readonly summary: string;
  readonly rawSanitized: string;
  readonly pcmBytes?: number;
}

export interface CadenceEventRecord extends NormalizedCadenceInput {
  readonly seq: number;
}

export interface CopilotTurnResult {
  readonly turnId: string;
  readonly sessionId?: string;
  readonly problemId?: string;
  readonly trigger: AnswerTriggerKind;
  readonly transcript: string;
  readonly answerBullets: readonly string[];
  readonly grounding: GroundingMode;
  readonly matchedKbHeadings: readonly string[];
  readonly providerName: string;
  readonly latencyMs: number;
  readonly webcamThumbnailDataUrl?: string | null;
}

export interface CadenceState {
  readonly phase: CadencePhase;
  readonly lifecycle: SessionLifecycle;
  readonly audioSourceMode: AudioSourceMode;
  readonly activeRecordingBytes: number;
  readonly activeRecordingSeconds: number;
  readonly statusDetail: string;
  readonly activeTurn: CopilotTurnResult | null;
  readonly answerPages: readonly string[];
  readonly answerPageIndex: number;
  readonly errorMessage: string | null;
  readonly lastInput: CadenceEventRecord | null;
  readonly events: readonly CadenceEventRecord[];
  readonly nextSeq: number;
}

export type CadenceSideEffect =
  | "none"
  | "upgrade_text"
  | "start_audio_capture"
  | "stop_and_submit_audio"
  | "capture_webcam_and_ask"
  | "request_shutdown"
  | "teardown";

export interface CadenceTransition {
  readonly state: CadenceState;
  readonly sideEffect: CadenceSideEffect;
}

export const MAX_EVENT_LOG = 16;
export const MAX_G2_LINE_CHARS = 44;
export const MAX_CONTENT_LINES_PER_PAGE = 7;
export const MAX_RECORDING_BYTES = 16000 * 2 * 60; // 60s @ 16kHz 16-bit mono (~1.92 MB)

const AUDIO_SOURCE_ORDER: readonly AudioSourceMode[] = [
  "g2-mic",
  "phone-mic",
  "mac-mic",
];

export function formatAudioSourceLabel(mode: AudioSourceMode): string {
  switch (mode) {
    case "g2-mic":
      return "G2-MIC";
    case "phone-mic":
      return "PHN-MIC";
    case "mac-mic":
      return "MAC-MIC";
  }
}

export function nextAudioSourceMode(current: AudioSourceMode): AudioSourceMode {
  const idx = AUDIO_SOURCE_ORDER.indexOf(current);
  const nextIdx = idx < 0 ? 0 : (idx + 1) % AUDIO_SOURCE_ORDER.length;
  return AUDIO_SOURCE_ORDER[nextIdx] ?? "g2-mic";
}

/**
 * Word-wrap text into lines of at most `maxChars` so proportional LVGL text
 * fits comfortably within `innerWidth = 558px` on G2 `576x288` lenses.
 */
export function wrapGlassesLines(
  text: string,
  maxChars: number = MAX_G2_LINE_CHARS,
): string[] {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return [];
  }
  const words = trimmed.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
      }
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }
  return lines;
}

/**
 * Paginate a `CopilotTurnResult` into `<= 7` content lines per G2 page.
 */
export function paginateCopilotTurn(turn: CopilotTurnResult): string[] {
  const allLines: string[] = [];

  const cleanPrompt = turn.transcript.replace(/\s+/g, " ").trim();
  if (cleanPrompt) {
    const shortPrompt =
      cleanPrompt.length > 76 ? `${cleanPrompt.slice(0, 73)}...` : cleanPrompt;
    const qLines = wrapGlassesLines(`Q: ${shortPrompt}`, MAX_G2_LINE_CHARS);
    allLines.push(...qLines);
  }

  const bullets =
    turn.answerBullets.length > 0
      ? turn.answerBullets
      : ["No talking points returned."];

  for (const rawBullet of bullets) {
    const stripped = rawBullet.replace(/^[-*•]\s*/, "").trim();
    if (!stripped) continue;
    const wrapped = wrapGlassesLines(`• ${stripped}`, MAX_G2_LINE_CHARS);
    for (let i = 0; i < wrapped.length; i += 1) {
      const line = wrapped[i] ?? "";
      allLines.push(i === 0 ? line : `  ${line}`);
    }
  }

  if (allLines.length === 0) {
    return ["• Ready."];
  }

  const pages: string[] = [];
  for (let i = 0; i < allLines.length; i += MAX_CONTENT_LINES_PER_PAGE) {
    pages.push(allLines.slice(i, i + MAX_CONTENT_LINES_PER_PAGE).join("\n"));
  }
  return pages;
}

export function createInitialCadenceState(
  audioSourceMode: AudioSourceMode = "g2-mic",
): CadenceState {
  return {
    phase: "IDLE",
    lifecycle: "foreground",
    audioSourceMode,
    activeRecordingBytes: 0,
    activeRecordingSeconds: 0,
    statusDetail: "Ready for interview prompt or webcam snapshot.",
    activeTurn: null,
    answerPages: [],
    answerPageIndex: 0,
    errorMessage: null,
    lastInput: null,
    events: [],
    nextSeq: 1,
  };
}

/**
 * Apply a normalized EvenHub or UI command to the pure Cadence state machine.
 */
export function applyCadenceInput(
  state: CadenceState,
  input: NormalizedCadenceInput,
): CadenceTransition {
  // Audio frames update byte counters without flooding the visible gesture log.
  if (input.command === "audio_chunk_received") {
    if (state.phase !== "LISTENING") {
      return { state, sideEffect: "none" };
    }
    const added = Math.max(0, input.pcmBytes ?? 0);
    const nextBytes = Math.min(
      MAX_RECORDING_BYTES,
      state.activeRecordingBytes + added,
    );
    const nextSeconds = Math.round((nextBytes / (16000 * 2)) * 10) / 10;
    const shouldRefreshHud =
      Math.floor(nextSeconds) !== Math.floor(state.activeRecordingSeconds);
    const nextState: CadenceState = {
      ...state,
      activeRecordingBytes: nextBytes,
      activeRecordingSeconds: nextSeconds,
    };
    return {
      state: nextState,
      sideEffect: shouldRefreshHud ? "upgrade_text" : "none",
    };
  }

  const record: CadenceEventRecord = {
    ...input,
    seq: state.nextSeq,
  };
  const events = [record, ...state.events].slice(0, MAX_EVENT_LOG);
  const base: CadenceState = {
    ...state,
    lastInput: record,
    events,
    nextSeq: state.nextSeq + 1,
  };

  switch (input.command) {
    case "ring_hold_start": {
      if (state.phase === "LISTENING") {
        return { state: base, sideEffect: "none" };
      }
      return {
        state: {
          ...base,
          phase: "LISTENING",
          activeRecordingBytes: 0,
          activeRecordingSeconds: 0,
          errorMessage: null,
          statusDetail: `Listening on ${formatAudioSourceLabel(state.audioSourceMode)}... release R1 to answer.`,
        },
        sideEffect: "start_audio_capture",
      };
    }

    case "ring_hold_release": {
      if (state.phase !== "LISTENING") {
        return { state: base, sideEffect: "upgrade_text" };
      }
      return {
        state: {
          ...base,
          phase: "TRANSCRIBING",
          statusDetail: "Transcribing speech & matching Knowledge Base...",
        },
        sideEffect: "stop_and_submit_audio",
      };
    }

    case "trigger_webcam_capture": {
      if (state.phase === "LISTENING") {
        return { state: base, sideEffect: "none" };
      }
      return {
        state: {
          ...base,
          phase: "CAPTURING_PHOTO",
          errorMessage: null,
          statusDetail: "Capturing Logitech webcam frame & analyzing...",
        },
        sideEffect: "capture_webcam_and_ask",
      };
    }

    case "cycle_audio_source": {
      const nextMode = nextAudioSourceMode(state.audioSourceMode);
      return {
        state: {
          ...base,
          audioSourceMode: nextMode,
          statusDetail: `Switched microphone to ${formatAudioSourceLabel(nextMode)}.`,
        },
        sideEffect: "upgrade_text",
      };
    }

    case "clear_answer": {
      return {
        state: {
          ...base,
          phase: "IDLE",
          activeTurn: null,
          answerPages: [],
          answerPageIndex: 0,
          errorMessage: null,
          statusDetail: "Cleared HUD. Ready for next question.",
        },
        sideEffect: "upgrade_text",
      };
    }

    case "scroll_down": {
      if (state.answerPages.length <= 1) {
        return { state: base, sideEffect: "upgrade_text" };
      }
      const nextIdx = Math.min(
        state.answerPages.length - 1,
        state.answerPageIndex + 1,
      );
      return {
        state: {
          ...base,
          answerPageIndex: nextIdx,
        },
        sideEffect: "upgrade_text",
      };
    }

    case "scroll_up": {
      if (state.answerPages.length <= 1) {
        return { state: base, sideEffect: "upgrade_text" };
      }
      const prevIdx = Math.max(0, state.answerPageIndex - 1);
      return {
        state: {
          ...base,
          answerPageIndex: prevIdx,
        },
        sideEffect: "upgrade_text",
      };
    }

    case "request_exit":
      return {
        state: base,
        sideEffect: "request_shutdown",
      };

    case "foreground_enter":
      return {
        state: {
          ...base,
          lifecycle: "foreground",
        },
        sideEffect: "upgrade_text",
      };

    case "foreground_exit":
      return {
        state: {
          ...base,
          lifecycle: "background",
          phase: state.phase === "LISTENING" ? "IDLE" : state.phase,
        },
        sideEffect: "none",
      };

    case "session_closed":
      return {
        state: {
          ...base,
          lifecycle: "closed",
          phase: state.phase === "LISTENING" ? "IDLE" : state.phase,
        },
        sideEffect: "teardown",
      };

    case "unknown":
      return {
        state: base,
        sideEffect: "none",
      };
  }
}

export function setCadenceThinking(
  state: CadenceState,
  statusDetail: string,
): CadenceState {
  return {
    ...state,
    phase: "THINKING",
    errorMessage: null,
    statusDetail,
  };
}

export function setCadenceAudioSource(
  state: CadenceState,
  audioSourceMode: AudioSourceMode,
): CadenceState {
  return {
    ...state,
    audioSourceMode,
    statusDetail: `Active mic: ${formatAudioSourceLabel(audioSourceMode)}.`,
  };
}

export function applyCadenceTurnResult(
  state: CadenceState,
  turn: CopilotTurnResult,
): CadenceState {
  // Idempotent if the same turnId arrives from both HTTP response and SSE broadcast.
  if (
    state.activeTurn?.turnId === turn.turnId &&
    state.phase === "ANSWER_READY"
  ) {
    return state;
  }
  const pages = paginateCopilotTurn(turn);
  const badge = turn.grounding === "kb" ? "[KB]" : "[GEN]";
  return {
    ...state,
    phase: "ANSWER_READY",
    activeRecordingBytes: 0,
    activeRecordingSeconds: 0,
    activeTurn: turn,
    answerPages: pages,
    answerPageIndex: 0,
    errorMessage: null,
    statusDetail: `${badge} Answered via ${turn.providerName} (${turn.latencyMs}ms).`,
  };
}

export function applyCadenceError(
  state: CadenceState,
  errorMessage: string,
): CadenceState {
  return {
    ...state,
    phase: "ERROR",
    activeRecordingBytes: 0,
    activeRecordingSeconds: 0,
    errorMessage,
    statusDetail: `Error: ${errorMessage}`,
  };
}

export function clearCadenceEventLog(state: CadenceState): CadenceState {
  return {
    ...state,
    lastInput: null,
    events: [],
  };
}

/**
 * Render the G2 `576x288` monochrome green container payload (`<= 9` lines).
 * Inner height = `288 - 2 * (8 + 1) = 270px` -> `10` LVGL lines max (`27px` line-height).
 */
export function formatCadenceGlassesScreen(state: CadenceState): string {
  const micLabel = formatAudioSourceLabel(state.audioSourceMode);
  const footer = "Hold R1: Ask | Tap: Cam | Swipe: Pg";

  if (state.phase === "LISTENING") {
    const secs = state.activeRecordingSeconds.toFixed(1);
    return [
      `CADENCE · ● REC ${secs}s · ${micLabel}`,
      "",
      "Listening to interview question...",
      "Keep holding R1 while speaking.",
      "Release R1 to transcribe & answer.",
      "",
      footer,
    ].join("\n");
  }

  if (state.phase === "TRANSCRIBING") {
    return [
      `CADENCE · TRANSCRIBING · ${micLabel}`,
      "",
      "Converting speech to text...",
      "Checking Knowledge Base for matches.",
      "",
      footer,
    ].join("\n");
  }

  if (state.phase === "CAPTURING_PHOTO") {
    return [
      `CADENCE · WEBCAM SNAP · ${micLabel}`,
      "",
      "Capturing Logitech webcam frame...",
      "Analyzing visual problem with Gemini.",
      "",
      footer,
    ].join("\n");
  }

  if (state.phase === "THINKING") {
    return [
      `CADENCE · THINKING · ${micLabel}`,
      "",
      state.statusDetail.slice(0, MAX_G2_LINE_CHARS),
      "Formatting concise talking points...",
      "",
      footer,
    ].join("\n");
  }

  if (state.phase === "ERROR") {
    const wrappedErr = wrapGlassesLines(
      state.errorMessage ?? "Request failed",
      MAX_G2_LINE_CHARS,
    ).slice(0, 4);
    return [`CADENCE · ALERT · ${micLabel}`, ...wrappedErr, "", footer].join(
      "\n",
    );
  }

  if (state.phase === "ANSWER_READY" && state.activeTurn) {
    const tag = state.activeTurn.grounding === "kb" ? "[KB]" : "[GEN]";
    const src =
      state.activeTurn.trigger === "webcam"
        ? "CAM"
        : state.activeTurn.trigger === "voice"
          ? "MIC"
          : "TXT";
    const totalPages = Math.max(1, state.answerPages.length);
    const pageNum = Math.min(totalPages, state.answerPageIndex + 1);
    const pageBody = state.answerPages[state.answerPageIndex] ?? "• Ready.";

    return [
      `CADENCE ${tag} ${src} · P${pageNum}/${totalPages}`,
      pageBody,
      footer,
    ].join("\n");
  }

  return [
    `CADENCE COPILOT · READY · ${micLabel}`,
    "• Hold R1 Ring: Record & transcribe Q",
    "• Release R1: Answer via KB or LLM",
    "• Single Tap: Snap Logitech webcam",
    "• Swipe Up/Dn: Scroll answer pages",
    "• Double Tap: Exit confirmation",
    footer,
  ].join("\n");
}
