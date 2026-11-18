import type { CopilotTurnResult } from "./domain/copilot.ts";
import type { KnowledgeDocument } from "./domain/knowledge-base.ts";
import {
  startCadenceSession,
  type CadenceSessionController,
  type CadenceSessionSnapshot,
} from "./even/adapter.ts";
import {
  createOperatorMediaController,
  type OperatorMediaController,
  type OperatorMediaState,
} from "./ui/operator-media.ts";
import { renderCadenceView, type ServerInfoSummary } from "./ui/phone-view.ts";

const appRoot = document.querySelector<HTMLElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app container in index.html");
}

const params = new URLSearchParams(window.location.search);
const mockMode = params.get("mock") === "1";
const isOperatorRole = params.get("role") === "operator";

let controller: CadenceSessionController | null = null;
let latestSnapshot: CadenceSessionSnapshot | null = null;
let operatorMediaState: OperatorMediaState | null = null;
let eventSource: EventSource | null = null;

let serverInfo: ServerInfoSummary = {
  providerName: "connecting...",
  liveApiKeyConfigured: false,
  webcamOperatorsConnected: 0,
  kbDocuments: [],
};

const renderAll = () => {
  if (!latestSnapshot) return;
  renderCadenceView(appRoot, {
    isOperatorRole,
    snapshot: latestSnapshot,
    serverInfo,
    operatorMediaState,
    getController: () => controller,
    operatorMedia,
    async onSaveKbNote(title, content, persistToDisk) {
      const res = await fetch("/api/cadence/kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, persistToDisk }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        documents?: KnowledgeDocument[];
      };
      if (json.ok && Array.isArray(json.documents)) {
        serverInfo = { ...serverInfo, kbDocuments: json.documents };
        renderAll();
      }
    },
  });
};

let operatorMedia: OperatorMediaController | null = null;
let webcamRegisteredOnSse = false;

function connectSseStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  const hasWebcam = Boolean(operatorMediaState?.webcamActive);
  webcamRegisteredOnSse = hasWebcam;
  const roleParam = isOperatorRole ? "operator" : "phone";
  const url = `/api/cadence/events?role=${roleParam}&webcam=${hasWebcam ? "1" : "0"}`;
  const es = new EventSource(url);
  eventSource = es;

  es.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data as string) as {
        type: string;
        payload: Record<string, unknown>;
      };
      if (event.type === "connected") {
        serverInfo = {
          ...serverInfo,
          providerName:
            typeof event.payload.providerName === "string"
              ? event.payload.providerName
              : serverInfo.providerName,
          liveApiKeyConfigured: event.payload.liveApiKeyConfigured === true,
          webcamOperatorsConnected:
            typeof event.payload.webcamOperatorsConnected === "number"
              ? event.payload.webcamOperatorsConnected
              : 0,
        };
        if (event.payload.latestTurn) {
          controller?.receiveExternalTurn(
            event.payload.latestTurn as CopilotTurnResult,
          );
        }
        renderAll();
      } else if (event.type === "status") {
        if (typeof event.payload.detail === "string") {
          controller?.receiveExternalStatus(event.payload.detail);
        }
      } else if (event.type === "turn_result") {
        if (event.payload.turn) {
          controller?.receiveExternalTurn(
            event.payload.turn as CopilotTurnResult,
          );
        }
      } else if (event.type === "error") {
        if (typeof event.payload.message === "string") {
          controller?.receiveExternalError(event.payload.message);
        }
      } else if (event.type === "kb_updated") {
        void refreshKbList();
      } else if (
        event.type === "capture_webcam_request" &&
        isOperatorRole &&
        operatorMedia
      ) {
        const requestId =
          typeof event.payload.requestId === "string"
            ? event.payload.requestId
            : "";
        const frame = operatorMedia.captureJpegFrame();
        if (requestId && frame) {
          void fetch("/api/cadence/operator-frame", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requestId,
              imageBase64: frame.imageBase64,
              mimeType: frame.mimeType,
              sourceLabel: frame.sourceLabel,
            }),
          });
        }
      } else if (
        event.type === "mac_mic_start" &&
        isOperatorRole &&
        operatorMedia
      ) {
        void operatorMedia.startMacMicRecording();
      } else if (
        event.type === "mac_mic_stop" &&
        isOperatorRole &&
        operatorMedia
      ) {
        void operatorMedia.stopMacMicAndEncodeWav().then((wavBase64) => {
          if (wavBase64) {
            void fetch("/api/cadence/audio-ask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                audioWavBase64: wavBase64,
                mimeType: "audio/wav",
              }),
            });
          }
        });
      }
    } catch {
      // Ignore malformed SSE frames.
    }
  };
}

async function refreshKbList() {
  try {
    const [stateRes, kbRes] = await Promise.all([
      fetch("/api/cadence/state"),
      fetch("/api/cadence/kb"),
    ]);
    const stateJson = (await stateRes.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const kbJson = (await kbRes.json().catch(() => ({}))) as {
      documents?: KnowledgeDocument[];
    };
    serverInfo = {
      providerName:
        typeof stateJson.providerName === "string"
          ? stateJson.providerName
          : serverInfo.providerName,
      liveApiKeyConfigured: stateJson.liveApiKeyConfigured === true,
      webcamOperatorsConnected:
        typeof stateJson.webcamOperatorsConnected === "number"
          ? stateJson.webcamOperatorsConnected
          : serverInfo.webcamOperatorsConnected,
      kbDocuments: Array.isArray(kbJson.documents)
        ? kbJson.documents
        : serverInfo.kbDocuments,
    };
    renderAll();
  } catch {
    // Server state will populate once available.
  }
}

if (isOperatorRole) {
  operatorMedia = createOperatorMediaController((nextMediaState) => {
    operatorMediaState = nextMediaState;
    if (nextMediaState.webcamActive !== webcamRegisteredOnSse) {
      connectSseStream();
    }
    renderAll();
  });
  operatorMediaState = operatorMedia.getState();
}

controller = await startCadenceSession({
  mockMode,
  operatorMode: isOperatorRole,
  onSnapshot(snapshot) {
    latestSnapshot = snapshot;
    renderAll();
    const seq = snapshot.domain.nextSeq - 1;
    const lastCmd = snapshot.domain.lastInput?.command ?? "none";
    const lastOrigin = snapshot.domain.lastInput?.origin ?? "none";
    console.info(
      `[cadence] STATE phase=${snapshot.domain.phase} page=${snapshot.domain.answerPageIndex} status=${snapshot.connectionStatus} seq=${seq} last=${lastCmd} origin=${lastOrigin}`,
    );
  },
  onReady({ mode }) {
    appRoot.dataset.appReady = "true";
    console.info(`[cadence] APP_READY mode=${mode}`);
  },
});

connectSseStream();
void refreshKbList();

const cleanup = () => {
  eventSource?.close();
  eventSource = null;
  operatorMedia?.dispose();
  operatorMedia = null;
  controller?.dispose();
  controller = null;
};

window.addEventListener("pagehide", cleanup, { once: true });
window.addEventListener("beforeunload", cleanup, { once: true });

if (import.meta.hot) {
  import.meta.hot.dispose(cleanup);
}
