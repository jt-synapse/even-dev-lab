// Thin Even SDK integration boundary for Cadence (blueprint §3 & ADR-005).
// Only module in apps/cadence allowed to import @evenrealities/even_hub_sdk.

import {
  AudioInputSource,
  CreateStartUpPageContainer,
  EventSourceType,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type AppImageAsset,
  type DeviceInfo,
  type DeviceStatus,
  type EvenHubEvent,
  type LaunchSource,
} from "@evenrealities/even_hub_sdk";

import {
  applyCadenceError,
  applyCadenceInput,
  applyCadenceTurnResult,
  clearCadenceEventLog,
  createInitialCadenceState,
  formatCadenceGlassesScreen,
  MAX_RECORDING_BYTES,
  setCadenceAudioSource,
  setCadenceThinking,
  type AudioSourceMode,
  type CadenceCommand,
  type CadenceState,
  type CopilotTurnResult,
  type InputOrigin,
  type NormalizedCadenceInput,
} from "../domain/copilot.ts";
import { encodeBytesToBase64, encodePcm16LeToWav } from "../domain/wav.ts";

export const CADENCE_CONTAINER_ID = 1;
export const CADENCE_CONTAINER_NAME = "cadence-hud";
export const MENU_SNAP_WEBCAM_ID = 1;
export const MENU_SWITCH_MIC_ID = 2;
export const MENU_CLEAR_HUD_ID = 3;

export const DEFAULT_BRIDGE_TIMEOUT_MS = 5000;
export const DEFAULT_CALL_TIMEOUT_MS = 4500;

export type BridgeConnectionStatus =
  "connecting" | "ready" | "operator" | "mock" | "failed" | "closed";

export interface DeviceStatusSummary {
  readonly model?: string | null;
  readonly connectType: string;
  readonly batteryLevel: number | null;
  readonly isWearing: boolean | null;
  readonly isCharging?: boolean | null;
  readonly isInCase?: boolean | null;
}

export interface CadenceSessionSnapshot {
  readonly connectionStatus: BridgeConnectionStatus;
  readonly modeLabel: string;
  readonly errorMessage: string | null;
  readonly launchSource: LaunchSource | null;
  readonly deviceStatus: DeviceStatusSummary | null;
  readonly attachWebcamOnVoice: boolean;
  readonly screenText: string;
  readonly domain: CadenceState;
}

export interface EvenBridgeTransport {
  createStartUpPageContainer(
    container: CreateStartUpPageContainer,
  ): Promise<StartUpPageCreateResult>;
  textContainerUpgrade(container: TextContainerUpgrade): Promise<boolean>;
  audioControl(isOpen: boolean, source?: AudioInputSource): Promise<boolean>;
  captureImageFromCamera?: () => Promise<AppImageAsset | null>;
  shutDownPageContainer(exitMode?: number): Promise<boolean>;
  getDeviceInfo?: () => Promise<DeviceInfo | null>;
  onEvenHubEvent(callback: (event: EvenHubEvent) => void): () => void;
  onLaunchSource(callback: (source: LaunchSource) => void): () => void;
  onDeviceStatusChanged(callback: (status: DeviceStatus) => void): () => void;
}

export interface CadenceBackendClient {
  submitAudioTurn(params: {
    readonly audioWavBase64: string;
    readonly hintTranscript?: string;
    readonly attachWebcam?: boolean;
  }): Promise<CopilotTurnResult>;
  submitWebcamTurn(params?: {
    readonly prompt?: string;
    readonly imageBase64?: string;
    readonly mimeType?: string;
  }): Promise<CopilotTurnResult>;
  submitTextTurn(question: string): Promise<CopilotTurnResult>;
  startMacMic(): Promise<void>;
  stopMacMic(): Promise<void>;
}

export interface StartCadenceSessionOptions {
  readonly mockMode?: boolean;
  readonly operatorMode?: boolean;
  readonly initialAudioSource?: AudioSourceMode;
  readonly bridgeTimeoutMs?: number;
  readonly callTimeoutMs?: number;
  readonly nowIso?: () => string;
  readonly resolveBridge?: () => Promise<EvenBridgeTransport>;
  readonly backend?: CadenceBackendClient;
  readonly onSnapshot: (snapshot: CadenceSessionSnapshot) => void;
  readonly onReady?: (info: { mode: "bridge" | "mock" | "operator" }) => void;
}

export interface CadenceSessionController {
  getSnapshot(): CadenceSessionSnapshot;
  dispatchCommand(command: CadenceCommand, origin?: InputOrigin): void;
  setAudioSourceMode(mode: AudioSourceMode): void;
  setAttachWebcamOnVoice(enabled: boolean): void;
  askTextQuestion(question: string): Promise<void>;
  triggerWebcamCapture(prompt?: string): Promise<void>;
  capturePhoneCameraFallback(prompt?: string): Promise<void>;
  receiveExternalTurn(turn: CopilotTurnResult): void;
  receiveExternalStatus(detail: string): void;
  receiveExternalError(message: string): void;
  clearEvents(): void;
  dispose(): void;
}

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|api_key|private_key|credential|authorization/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (value instanceof Uint8Array) {
    return { byteLength: value.byteLength };
  }
  if (Array.isArray(value)) {
    if (value.length > 12) {
      return `[array(${value.length})]`;
    }
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
      } else if (key === "audioPcm") {
        const len =
          entry instanceof Uint8Array
            ? entry.byteLength
            : Array.isArray(entry)
              ? entry.length
              : 0;
        out[key] = { pcmBytes: len };
      } else {
        out[key] = sanitizeValue(entry, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "string" && value.length > 120) {
    return `${value.slice(0, 117)}...`;
  }
  return value;
}

export function sanitizeRawEvent(event: EvenHubEvent): string {
  try {
    const sanitized = sanitizeValue({
      ...(event.listEvent ? { listEvent: event.listEvent } : {}),
      ...(event.textEvent ? { textEvent: event.textEvent } : {}),
      ...(event.sysEvent ? { sysEvent: event.sysEvent } : {}),
      ...(event.menuItemClickEvent
        ? { menuItemClickEvent: event.menuItemClickEvent }
        : {}),
      ...(event.audioEvent
        ? {
            audioEvent: {
              source: event.audioEvent.source,
              pcmBytes: event.audioEvent.audioPcm.byteLength,
            },
          }
        : {}),
    });
    const text = JSON.stringify(sanitized);
    return text.length > 280 ? `${text.slice(0, 277)}...` : text;
  } catch {
    return '{"unserializable":true}';
  }
}

export function mapEventSource(source?: EventSourceType): InputOrigin {
  if (source === undefined) {
    // Blueprint §9 & CAP-006: never infer ring from missing eventSource.
    return "unknown";
  }
  switch (source) {
    case EventSourceType.TOUCH_EVENT_FORM_DUMMY_NULL:
      return "none";
    case EventSourceType.TOUCH_EVENT_FROM_GLASSES_R:
      return "glasses_right";
    case EventSourceType.TOUCH_EVENT_FROM_RING:
      return "ring";
    case EventSourceType.TOUCH_EVENT_FROM_GLASSES_L:
      return "glasses_left";
    default:
      return "unknown";
  }
}

function mapOsEventToCadenceCommand(
  eventType: OsEventTypeList,
): CadenceCommand {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
      return "trigger_webcam_capture";
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return "scroll_up";
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return "scroll_down";
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return "request_exit";
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return "foreground_enter";
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return "foreground_exit";
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      return "session_closed";
    case OsEventTypeList.LONG_PRESS_EVENT:
      return "ring_hold_start";
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return "ring_hold_release";
    case OsEventTypeList.IMU_DATA_REPORT:
    default:
      return "unknown";
  }
}

/**
 * Normalize an EvenHubEvent into a Cadence-owned NormalizedCadenceInput.
 * Applies protobuf zero-value omission (`?? CLICK_EVENT`) inside present envelopes only.
 */
export function normalizeCadenceEvenHubEvent(
  event: EvenHubEvent,
  timestampIso: string,
): NormalizedCadenceInput {
  const rawSanitized = sanitizeRawEvent(event);

  if (event.menuItemClickEvent) {
    const itemId = event.menuItemClickEvent.itemID ?? 0;
    const command: CadenceCommand =
      itemId === MENU_SNAP_WEBCAM_ID
        ? "trigger_webcam_capture"
        : itemId === MENU_SWITCH_MIC_ID
          ? "cycle_audio_source"
          : itemId === MENU_CLEAR_HUD_ID
            ? "clear_answer"
            : "unknown";
    return {
      command,
      origin: "unknown",
      timestampIso,
      summary: `menu #${itemId} -> ${command}`,
      rawSanitized,
    };
  }

  if (event.listEvent) {
    const eventType = event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    const command = mapOsEventToCadenceCommand(eventType);
    return {
      command,
      origin: "unknown",
      timestampIso,
      summary: `list ${command}`,
      rawSanitized,
    };
  }

  if (event.textEvent) {
    const eventType = event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    const command = mapOsEventToCadenceCommand(eventType);
    return {
      command,
      origin: "unknown",
      timestampIso,
      summary: `text(${event.textEvent.containerName ?? "hud"}) ${command}`,
      rawSanitized,
    };
  }

  if (event.sysEvent) {
    const eventType = event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    const command = mapOsEventToCadenceCommand(eventType);
    const origin = mapEventSource(event.sysEvent.eventSource);
    return {
      command,
      origin,
      timestampIso,
      summary: `sys ${command} via ${origin}`,
      rawSanitized,
    };
  }

  if (event.audioEvent) {
    return {
      command: "audio_chunk_received",
      origin: "unknown",
      timestampIso,
      summary: `pcm (${event.audioEvent.source}, ${event.audioEvent.audioPcm.byteLength}B)`,
      rawSanitized,
      pcmBytes: event.audioEvent.audioPcm.byteLength,
    };
  }

  return {
    command: "unknown",
    origin: "unknown",
    timestampIso,
    summary: "unrecognized event envelope",
    rawSanitized,
  };
}

export function createHttpCadenceBackendClient(
  baseUrl: string = "",
): CadenceBackendClient {
  const postJson = async <T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok || json.ok === false) {
      const errMsg =
        typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
      throw new Error(errMsg);
    }
    return json as T;
  };

  return {
    async submitAudioTurn(params) {
      const data = await postJson<{ turn: CopilotTurnResult }>(
        "/api/cadence/audio-ask",
        {
          audioWavBase64: params.audioWavBase64,
          mimeType: "audio/wav",
          hintTranscript: params.hintTranscript,
          attachWebcam: params.attachWebcam === true,
        },
      );
      return data.turn;
    },
    async submitWebcamTurn(params) {
      const data = await postJson<{ turn: CopilotTurnResult }>(
        "/api/cadence/vision-ask",
        {
          prompt: params?.prompt,
          imageBase64: params?.imageBase64,
          mimeType: params?.mimeType,
        },
      );
      return data.turn;
    },
    async submitTextTurn(question) {
      const data = await postJson<{ turn: CopilotTurnResult }>(
        "/api/cadence/text-ask",
        { question, requestId: globalThis.crypto?.randomUUID?.() },
      );
      return data.turn;
    },
    async startMacMic() {
      await postJson("/api/cadence/mac-mic/start", {});
    },
    async stopMacMic() {
      await postJson("/api/cadence/mac-mic/stop", {});
    },
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function startupResultMessage(result: StartUpPageCreateResult): string {
  switch (result) {
    case StartUpPageCreateResult.invalid:
      return "createStartUpPageContainer rejected payload as invalid (code 1)";
    case StartUpPageCreateResult.oversize:
      return "createStartUpPageContainer rejected payload as oversize (code 2)";
    case StartUpPageCreateResult.outOfMemory:
      return "createStartUpPageContainer failed with outOfMemory (code 3)";
    default:
      return `createStartUpPageContainer failed (code ${String(result)})`;
  }
}

function buildStartupPayload(content: string): CreateStartUpPageContainer {
  const hudText = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 1,
    borderColor: 5,
    borderRadius: 4,
    paddingLength: 8,
    containerID: CADENCE_CONTAINER_ID,
    containerName: CADENCE_CONTAINER_NAME,
    content,
    isEventCapture: 1,
  });

  const menuObject = new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({
        itemID: MENU_SNAP_WEBCAM_ID,
        itemName: "Snap Webcam",
      }),
      new MenuItemProperty({
        itemID: MENU_SWITCH_MIC_ID,
        itemName: "Switch Mic Source",
      }),
      new MenuItemProperty({
        itemID: MENU_CLEAR_HUD_ID,
        itemName: "Clear Answer",
      }),
    ],
  });

  return new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [hudText],
    menuObject,
  });
}

function buildTextUpgradePayload(content: string): TextContainerUpgrade {
  return new TextContainerUpgrade({
    containerID: CADENCE_CONTAINER_ID,
    containerName: CADENCE_CONTAINER_NAME,
    contentOffset: 0,
    contentLength: 0,
    content,
  });
}

export async function startCadenceSession(
  options: StartCadenceSessionOptions,
): Promise<CadenceSessionController> {
  const bridgeTimeoutMs = options.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const resolveBridge = options.resolveBridge ?? (() => waitForEvenAppBridge());
  const backend = options.backend ?? createHttpCadenceBackendClient();

  let domain = createInitialCadenceState(
    options.initialAudioSource ?? "g2-mic",
  );
  let connectionStatus: BridgeConnectionStatus = options.operatorMode
    ? "operator"
    : options.mockMode
      ? "mock"
      : "connecting";
  let errorMessage: string | null = null;
  let launchSource: LaunchSource | null = null;
  let deviceStatus: DeviceStatusSummary | null = null;
  let attachWebcamOnVoice = false;
  let disposed = false;
  let bridge: EvenBridgeTransport | null = null;
  let bridgeMicOpen = false;
  let recordedPcmChunks: Uint8Array[] = [];
  let recordedPcmBytes = 0;

  const cleanups: Array<() => void> = [];
  let serialQueue: Promise<void> = Promise.resolve();

  const buildSnapshot = (): CadenceSessionSnapshot => {
    const modeLabel =
      connectionStatus === "ready"
        ? "BRIDGE READY"
        : connectionStatus === "operator"
          ? "MAC OPERATOR STATION"
          : connectionStatus === "mock"
            ? "MOCK MODE (NO BRIDGE)"
            : connectionStatus === "failed"
              ? "BRIDGE ERROR"
              : connectionStatus === "closed"
                ? "SESSION CLOSED"
                : "CONNECTING";

    return {
      connectionStatus,
      modeLabel,
      errorMessage,
      launchSource,
      deviceStatus,
      attachWebcamOnVoice,
      screenText: formatCadenceGlassesScreen(domain),
      domain,
    };
  };

  const emit = () => {
    if (!disposed) {
      options.onSnapshot(buildSnapshot());
    }
  };

  const enqueueBridgeOp = (label: string, fn: () => Promise<void>) => {
    serialQueue = serialQueue
      .then(async () => {
        if (disposed) return;
        await withTimeout(fn(), callTimeoutMs, label);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[cadence] BRIDGE_OP_ERROR ${label}: ${msg}`);
        errorMessage = `${label}: ${msg}`;
        emit();
      });
  };

  const pushHudToGlasses = () => {
    if (!bridge || connectionStatus !== "ready") return;
    const activeBridge = bridge;
    const nextContent = formatCadenceGlassesScreen(domain);
    enqueueBridgeOp("textContainerUpgrade", async () => {
      const ok = await activeBridge.textContainerUpgrade(
        buildTextUpgradePayload(nextContent),
      );
      if (!ok) {
        throw new Error("host returned false");
      }
    });
  };

  const stopBridgeMicBestEffort = () => {
    if (!bridge || !bridgeMicOpen) return;
    const activeBridge = bridge;
    bridgeMicOpen = false;
    enqueueBridgeOp("audioControl(false)", async () => {
      await activeBridge.audioControl(false);
    });
  };

  const runTeardown = () => {
    if (disposed) return;
    disposed = true;
    if (bridge && bridgeMicOpen) {
      bridgeMicOpen = false;
      try {
        void bridge.audioControl(false);
      } catch {
        // Ignore teardown audio close error.
      }
    }
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        fn?.();
      } catch {
        // Ignore individual listener cleanup errors.
      }
    }
    bridge = null;
  };

  const applyTurnAndSync = (turn: CopilotTurnResult) => {
    if (disposed) return;
    domain = applyCadenceTurnResult(domain, turn);
    emit();
    pushHudToGlasses();
  };

  const applyFailureAndSync = (err: unknown) => {
    if (disposed) return;
    const msg = err instanceof Error ? err.message : String(err);
    domain = applyCadenceError(domain, msg);
    emit();
    pushHudToGlasses();
  };

  const executeWebcamCaptureFlow = async (prompt?: string) => {
    try {
      const turn = await backend.submitWebcamTurn({ prompt });
      applyTurnAndSync(turn);
    } catch (err: unknown) {
      applyFailureAndSync(err);
    }
  };

  const executeStartAudioCapture = () => {
    recordedPcmChunks = [];
    recordedPcmBytes = 0;
    pushHudToGlasses();

    if (domain.audioSourceMode === "mac-mic") {
      void backend.startMacMic().catch((err: unknown) => {
        applyFailureAndSync(err);
      });
      return;
    }

    if (bridge && connectionStatus === "ready") {
      const activeBridge = bridge;
      const source =
        domain.audioSourceMode === "phone-mic"
          ? AudioInputSource.Phone
          : AudioInputSource.Glasses;
      bridgeMicOpen = true;
      enqueueBridgeOp(`audioControl(true, ${source})`, async () => {
        await activeBridge.audioControl(true, source);
      });
    }
  };

  const executeStopAndSubmitAudio = () => {
    pushHudToGlasses();

    if (domain.audioSourceMode === "mac-mic") {
      void backend.stopMacMic().catch((err: unknown) => {
        applyFailureAndSync(err);
      });
      return;
    }

    stopBridgeMicBestEffort();
    const chunksSnapshot = recordedPcmChunks;
    recordedPcmChunks = [];
    recordedPcmBytes = 0;

    const wavBytes = encodePcm16LeToWav(chunksSnapshot);
    const audioWavBase64 = encodeBytesToBase64(wavBytes);

    void backend
      .submitAudioTurn({
        audioWavBase64,
        attachWebcam: attachWebcamOnVoice,
      })
      .then((turn) => {
        applyTurnAndSync(turn);
      })
      .catch((err: unknown) => {
        applyFailureAndSync(err);
      });
  };

  const handleNormalizedInput = (
    input: NormalizedCadenceInput,
    rawAudioPcm?: Uint8Array,
  ) => {
    if (disposed) return;

    if (
      input.command === "audio_chunk_received" &&
      rawAudioPcm &&
      domain.phase === "LISTENING" &&
      recordedPcmBytes < MAX_RECORDING_BYTES
    ) {
      const remaining = MAX_RECORDING_BYTES - recordedPcmBytes;
      const slice =
        rawAudioPcm.byteLength > remaining
          ? rawAudioPcm.subarray(0, remaining)
          : rawAudioPcm;
      recordedPcmChunks.push(new Uint8Array(slice));
      recordedPcmBytes += slice.byteLength;
    }

    const transition = applyCadenceInput(domain, input);
    domain = transition.state;

    if (input.command === "foreground_exit") {
      stopBridgeMicBestEffort();
    }

    if (transition.sideEffect === "teardown") {
      connectionStatus = "closed";
      options.onSnapshot(buildSnapshot());
      runTeardown();
      return;
    }

    emit();

    switch (transition.sideEffect) {
      case "upgrade_text":
        pushHudToGlasses();
        break;
      case "start_audio_capture":
        executeStartAudioCapture();
        break;
      case "stop_and_submit_audio":
        executeStopAndSubmitAudio();
        break;
      case "capture_webcam_and_ask":
        pushHudToGlasses();
        void executeWebcamCaptureFlow();
        break;
      case "request_shutdown":
        if (bridge && connectionStatus === "ready") {
          const activeBridge = bridge;
          enqueueBridgeOp("shutDownPageContainer", async () => {
            await activeBridge.shutDownPageContainer(1);
          });
        }
        break;
      case "none":
        break;
    }
  };

  const controller: CadenceSessionController = {
    getSnapshot: buildSnapshot,

    dispatchCommand(command: CadenceCommand, origin: InputOrigin = "ui") {
      if (disposed) return;
      handleNormalizedInput({
        command,
        origin,
        timestampIso: nowIso(),
        summary: `ui ${command}`,
        rawSanitized: JSON.stringify({ ui: true, command, origin }),
      });
    },

    setAudioSourceMode(mode: AudioSourceMode) {
      if (disposed) return;
      domain = setCadenceAudioSource(domain, mode);
      emit();
      pushHudToGlasses();
    },

    setAttachWebcamOnVoice(enabled: boolean) {
      if (disposed) return;
      attachWebcamOnVoice = enabled;
      emit();
    },

    async askTextQuestion(question: string) {
      if (disposed || !question.trim()) return;
      domain = setCadenceThinking(
        domain,
        "Querying Knowledge Base & Gemini...",
      );
      emit();
      pushHudToGlasses();
      try {
        const turn = await backend.submitTextTurn(question.trim());
        applyTurnAndSync(turn);
      } catch (err: unknown) {
        applyFailureAndSync(err);
      }
    },

    async triggerWebcamCapture(prompt?: string) {
      if (disposed) return;
      domain = setCadenceThinking(
        domain,
        "Capturing Logitech webcam & analyzing...",
      );
      emit();
      pushHudToGlasses();
      await executeWebcamCaptureFlow(prompt);
    },

    async capturePhoneCameraFallback(prompt?: string) {
      if (disposed) return;
      if (!bridge?.captureImageFromCamera || connectionStatus !== "ready") {
        applyFailureAndSync(
          new Error(
            "Phone camera bridge requires the Even companion app WebView.",
          ),
        );
        return;
      }
      domain = setCadenceThinking(domain, "Opening phone camera...");
      emit();
      try {
        const asset = await bridge.captureImageFromCamera();
        if (!asset || !asset.base64) {
          domain = setCadenceThinking(domain, "Phone camera cancelled.");
          emit();
          return;
        }
        const turn = await backend.submitWebcamTurn({
          prompt,
          imageBase64: asset.base64,
          mimeType: asset.mimeType || "image/jpeg",
        });
        applyTurnAndSync(turn);
      } catch (err: unknown) {
        applyFailureAndSync(err);
      }
    },

    receiveExternalTurn(turn: CopilotTurnResult) {
      applyTurnAndSync(turn);
    },

    receiveExternalStatus(detail: string) {
      if (disposed || domain.phase === "LISTENING") return;
      domain = setCadenceThinking(domain, detail);
      emit();
      pushHudToGlasses();
    },

    receiveExternalError(message: string) {
      applyFailureAndSync(new Error(message));
    },

    clearEvents() {
      if (disposed) return;
      domain = clearCadenceEventLog(domain);
      emit();
    },

    dispose() {
      runTeardown();
    },
  };

  emit();

  if (options.operatorMode) {
    options.onReady?.({ mode: "operator" });
    return controller;
  }

  if (options.mockMode) {
    options.onReady?.({ mode: "mock" });
    return controller;
  }

  try {
    const resolved = await withTimeout(
      resolveBridge(),
      bridgeTimeoutMs,
      "waitForEvenAppBridge",
    );
    if (disposed) {
      return controller;
    }
    bridge = resolved;

    cleanups.push(
      resolved.onLaunchSource((source) => {
        launchSource = source;
        emit();
      }),
    );
    cleanups.push(
      resolved.onDeviceStatusChanged((status) => {
        deviceStatus = {
          model: deviceStatus?.model ?? null,
          connectType: String(status.connectType),
          batteryLevel: status.batteryLevel ?? null,
          isWearing: status.isWearing ?? null,
          isCharging: status.isCharging ?? null,
          isInCase: status.isInCase ?? null,
        };
        emit();
      }),
    );
    cleanups.push(
      resolved.onEvenHubEvent((event) => {
        handleNormalizedInput(
          normalizeCadenceEvenHubEvent(event, nowIso()),
          event.audioEvent?.audioPcm,
        );
      }),
    );

    const startupResult = await withTimeout(
      resolved.createStartUpPageContainer(
        buildStartupPayload(formatCadenceGlassesScreen(domain)),
      ),
      callTimeoutMs,
      "createStartUpPageContainer",
    );

    if (disposed) {
      return controller;
    }

    if (startupResult !== StartUpPageCreateResult.success) {
      connectionStatus = "failed";
      errorMessage = startupResultMessage(startupResult);
      runTeardown();
      options.onSnapshot(buildSnapshot());
      return controller;
    }

    connectionStatus = "ready";
    errorMessage = null;
    emit();
    options.onReady?.({ mode: "bridge" });

    if (typeof resolved.getDeviceInfo === "function") {
      let infoTimer: ReturnType<typeof setTimeout> | null = null;
      const cancelInfoTimer = () => {
        if (infoTimer !== null) {
          clearTimeout(infoTimer);
          infoTimer = null;
        }
      };
      cleanups.push(cancelInfoTimer);

      void Promise.race([
        Promise.resolve().then(() => resolved.getDeviceInfo?.()),
        new Promise<null>((resolve) => {
          infoTimer = setTimeout(
            () => resolve(null),
            Math.min(callTimeoutMs, 2000),
          );
        }),
      ])
        .then((info) => {
          cancelInfoTimer();
          if (disposed || connectionStatus !== "ready" || !info) {
            return;
          }
          // Omit serial number (`sn`) per workspace privacy contract.
          const nextModel = info.model
            ? String(info.model)
            : (deviceStatus?.model ?? null);
          deviceStatus = deviceStatus
            ? { ...deviceStatus, model: nextModel }
            : {
                model: nextModel,
                connectType: info.status?.connectType
                  ? String(info.status.connectType)
                  : "unknown",
                batteryLevel: info.status?.batteryLevel ?? null,
                isWearing: info.status?.isWearing ?? null,
                isCharging: info.status?.isCharging ?? null,
                isInCase: info.status?.isInCase ?? null,
              };
          emit();
        })
        .catch(() => {
          cancelInfoTimer();
        });
    }
  } catch (err: unknown) {
    if (!disposed) {
      connectionStatus = "failed";
      const rawMsg = err instanceof Error ? err.message : String(err);
      errorMessage = rawMsg.includes("Flutter handler")
        ? `${rawMsg} — open on iPhone Even App, launch corepack yarn sim:cadence, or switch to Mac Operator Station (?role=operator) for Logitech webcam control.`
        : rawMsg;
      runTeardown();
      options.onSnapshot(buildSnapshot());
    }
  }

  return controller;
}
