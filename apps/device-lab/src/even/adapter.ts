// Thin Even SDK integration boundary (blueprint §3 & §9).
// Only module in apps/device-lab allowed to import @evenrealities/even_hub_sdk.

import {
  CreateStartUpPageContainer,
  EventSourceType,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type DeviceStatus,
  type EvenHubEvent,
  type LaunchSource,
} from "@evenrealities/even_hub_sdk";

import {
  applyDiagnosticInput,
  clearDiagnosticEventLog,
  createInitialDiagnosticState,
  formatGlassesScreen,
  type DiagnosticCommand,
  type DiagnosticState,
  type InputOrigin,
  type NormalizedDeviceInput,
} from "../domain/diagnostic.ts";

export const MAIN_CONTAINER_ID = 1;
export const MAIN_CONTAINER_NAME = "diag-main";
export const DEFAULT_BRIDGE_TIMEOUT_MS = 5000;
export const DEFAULT_CALL_TIMEOUT_MS = 4000;

export type BridgeConnectionStatus =
  "connecting" | "ready" | "mock" | "failed" | "closed";

export interface DeviceStatusSummary {
  readonly connectType: string;
  readonly batteryLevel: number | null;
  readonly isWearing: boolean | null;
}

export interface DiagnosticSessionSnapshot {
  readonly connectionStatus: BridgeConnectionStatus;
  readonly modeLabel: string;
  readonly errorMessage: string | null;
  readonly launchSource: LaunchSource | null;
  readonly deviceStatus: DeviceStatusSummary | null;
  readonly screenText: string;
  readonly domain: DiagnosticState;
}

export interface EvenBridgeTransport {
  createStartUpPageContainer(
    container: CreateStartUpPageContainer,
  ): Promise<StartUpPageCreateResult>;
  textContainerUpgrade(container: TextContainerUpgrade): Promise<boolean>;
  shutDownPageContainer(exitMode?: number): Promise<boolean>;
  onEvenHubEvent(callback: (event: EvenHubEvent) => void): () => void;
  onLaunchSource(callback: (source: LaunchSource) => void): () => void;
  onDeviceStatusChanged(callback: (status: DeviceStatus) => void): () => void;
}

export interface StartSessionOptions {
  readonly mockMode?: boolean;
  readonly bridgeTimeoutMs?: number;
  readonly callTimeoutMs?: number;
  readonly nowIso?: () => string;
  readonly resolveBridge?: () => Promise<EvenBridgeTransport>;
  readonly onSnapshot: (snapshot: DiagnosticSessionSnapshot) => void;
  readonly onReady?: (info: { mode: "bridge" | "mock" }) => void;
}

export interface DiagnosticSessionController {
  getSnapshot(): DiagnosticSessionSnapshot;
  injectMockInput(command: DiagnosticCommand, origin?: InputOrigin): void;
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
    // Blueprint §9: allow absent source fields; never infer ring from missing eventSource.
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

function mapOsEventType(eventType: OsEventTypeList): DiagnosticCommand {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
      return "tap";
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
      return "long_press";
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return "long_press_release";
    case OsEventTypeList.IMU_DATA_REPORT:
    default:
      return "unknown";
  }
}

/**
 * Normalize an EvenHubEvent into an application-owned NormalizedDeviceInput.
 * Handles protobuf zero-value omission inside each present envelope only.
 */
export function normalizeEvenHubEvent(
  event: EvenHubEvent,
  timestampIso: string,
): NormalizedDeviceInput {
  const rawSanitized = sanitizeRawEvent(event);

  if (event.menuItemClickEvent) {
    const itemId = event.menuItemClickEvent.itemID ?? 0;
    return {
      command: "menu_select",
      origin: "unknown",
      timestampIso,
      summary: `menu item #${itemId}`,
      rawSanitized,
    };
  }

  if (event.listEvent) {
    const eventType = event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    const command = mapOsEventType(eventType);
    const index = event.listEvent.currentSelectItemIndex ?? 0;
    return {
      command,
      origin: "unknown",
      timestampIso,
      summary: `list[${index}] ${command}`,
      rawSanitized,
    };
  }

  if (event.textEvent) {
    const eventType = event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    const command = mapOsEventType(eventType);
    return {
      command,
      origin: "unknown",
      timestampIso,
      summary: `text(${event.textEvent.containerName ?? "unnamed"}) ${command}`,
      rawSanitized,
    };
  }

  if (event.sysEvent) {
    const eventType = event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    const command = mapOsEventType(eventType);
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
      command: "audio_frame",
      origin: "unknown",
      timestampIso,
      summary: `audio (${event.audioEvent.source}, ${event.audioEvent.audioPcm.byteLength}B)`,
      rawSanitized,
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
  const mainText = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 1,
    borderColor: 5,
    borderRadius: 4,
    paddingLength: 8,
    containerID: MAIN_CONTAINER_ID,
    containerName: MAIN_CONTAINER_NAME,
    content,
    isEventCapture: 1,
  });

  return new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  });
}

function buildTextUpgradePayload(content: string): TextContainerUpgrade {
  return new TextContainerUpgrade({
    containerID: MAIN_CONTAINER_ID,
    containerName: MAIN_CONTAINER_NAME,
    contentOffset: 0,
    contentLength: 0,
    content,
  });
}

export async function startDiagnosticSession(
  options: StartSessionOptions,
): Promise<DiagnosticSessionController> {
  const bridgeTimeoutMs = options.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const resolveBridge = options.resolveBridge ?? (() => waitForEvenAppBridge());

  let domain = createInitialDiagnosticState();
  let connectionStatus: BridgeConnectionStatus = options.mockMode
    ? "mock"
    : "connecting";
  let errorMessage: string | null = null;
  let launchSource: LaunchSource | null = null;
  let deviceStatus: DeviceStatusSummary | null = null;
  let disposed = false;
  let bridge: EvenBridgeTransport | null = null;
  const cleanups: Array<() => void> = [];
  let serialQueue: Promise<void> = Promise.resolve();

  const buildSnapshot = (): DiagnosticSessionSnapshot => {
    const modeLabel =
      connectionStatus === "ready"
        ? "BRIDGE READY"
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
      screenText: formatGlassesScreen(domain),
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
        errorMessage = `${label}: ${msg}`;
        emit();
      });
  };

  const runTeardown = () => {
    if (disposed) return;
    disposed = true;
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        fn?.();
      } catch {
        // Ignore individual listener cleanup errors during teardown.
      }
    }
    bridge = null;
  };

  const handleNormalizedInput = (input: NormalizedDeviceInput) => {
    if (disposed) return;
    const transition = applyDiagnosticInput(domain, input);
    domain = transition.state;

    if (transition.sideEffect === "teardown") {
      connectionStatus = "closed";
      options.onSnapshot(buildSnapshot());
      runTeardown();
      return;
    }

    emit();

    if (!bridge || connectionStatus !== "ready") {
      return;
    }

    const activeBridge = bridge;
    if (transition.sideEffect === "upgrade_text") {
      const nextContent = formatGlassesScreen(domain);
      enqueueBridgeOp("textContainerUpgrade", async () => {
        const ok = await activeBridge.textContainerUpgrade(
          buildTextUpgradePayload(nextContent),
        );
        if (!ok) {
          throw new Error("host returned false");
        }
      });
    } else if (transition.sideEffect === "request_shutdown") {
      enqueueBridgeOp("shutDownPageContainer", async () => {
        await activeBridge.shutDownPageContainer(1);
      });
    }
  };

  const controller: DiagnosticSessionController = {
    getSnapshot: buildSnapshot,
    injectMockInput(command: DiagnosticCommand, origin: InputOrigin = "none") {
      if (connectionStatus !== "mock" || disposed) return;
      handleNormalizedInput({
        command,
        origin,
        timestampIso: nowIso(),
        summary: `mock ${command}`,
        rawSanitized: JSON.stringify({ mock: true, command, origin }),
      });
    },
    clearEvents() {
      if (disposed) return;
      domain = clearDiagnosticEventLog(domain);
      emit();
    },
    dispose() {
      runTeardown();
    },
  };

  emit();

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

    // Subscribe to one-shot launch source and device status early (SDK contract).
    cleanups.push(
      resolved.onLaunchSource((source) => {
        launchSource = source;
        emit();
      }),
    );
    cleanups.push(
      resolved.onDeviceStatusChanged((status) => {
        deviceStatus = {
          connectType: String(status.connectType),
          batteryLevel: status.batteryLevel ?? null,
          isWearing: status.isWearing ?? null,
        };
        emit();
      }),
    );
    cleanups.push(
      resolved.onEvenHubEvent((event) => {
        handleNormalizedInput(normalizeEvenHubEvent(event, nowIso()));
      }),
    );

    const startupResult = await withTimeout(
      resolved.createStartUpPageContainer(
        buildStartupPayload(formatGlassesScreen(domain)),
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
  } catch (err: unknown) {
    if (!disposed) {
      connectionStatus = "failed";
      const rawMsg = err instanceof Error ? err.message : String(err);
      errorMessage = rawMsg.includes("Flutter handler")
        ? `${rawMsg} — open inside evenhub-simulator (corepack yarn sim:lab) or the Even phone app WebView.`
        : rawMsg;
      runTeardown();
      options.onSnapshot(buildSnapshot());
    }
  }

  return controller;
}
