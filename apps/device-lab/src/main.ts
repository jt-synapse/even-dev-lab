import {
  startDiagnosticSession,
  type DiagnosticSessionController,
} from "./even/adapter.ts";
import { renderPhoneDiagnosticView } from "./ui/phone-view.ts";

const appRoot = document.querySelector<HTMLElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app container in index.html");
}

const params = new URLSearchParams(window.location.search);
const mockMode = params.get("mock") === "1";

let controller: DiagnosticSessionController | null = null;

controller = await startDiagnosticSession({
  mockMode,
  onSnapshot(snapshot) {
    renderPhoneDiagnosticView(appRoot, snapshot, () => controller);
    console.info(
      `[device-lab] STATE phase=${snapshot.domain.phase} taps=${snapshot.domain.tapCount} focus=${snapshot.domain.focusIndex} status=${snapshot.connectionStatus}`,
    );
  },
  onReady({ mode }) {
    appRoot.dataset.appReady = "true";
    console.info(`[device-lab] APP_READY mode=${mode}`);
  },
});

const cleanup = () => {
  controller?.dispose();
  controller = null;
};

window.addEventListener("pagehide", cleanup, { once: true });
window.addEventListener("beforeunload", cleanup, { once: true });

if (import.meta.hot) {
  import.meta.hot.dispose(cleanup);
}
