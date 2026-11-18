// Companion Phone WebView & Mac Operator Station UI for Cadence (blueprint §3).
// Dark-surface tokens (#111111 / #1A1A1A / #FEF991) — never uses G2 green for phone chrome.

import type { AudioSourceMode } from "../domain/copilot.ts";
import type { KnowledgeDocument } from "../domain/knowledge-base.ts";
import type {
  BridgeConnectionStatus,
  CadenceSessionController,
  CadenceSessionSnapshot,
} from "../even/adapter.ts";
import type {
  OperatorMediaController,
  OperatorMediaState,
} from "./operator-media.ts";

export interface ServerInfoSummary {
  readonly providerName: string;
  readonly liveApiKeyConfigured: boolean;
  readonly webcamOperatorsConnected: number;
  readonly kbDocuments: readonly KnowledgeDocument[];
}

export interface CadenceUiContext {
  readonly isOperatorRole: boolean;
  readonly snapshot: CadenceSessionSnapshot;
  readonly serverInfo: ServerInfoSummary;
  readonly operatorMediaState: OperatorMediaState | null;
  readonly getController: () => CadenceSessionController | null;
  readonly operatorMedia: OperatorMediaController | null;
  readonly onSaveKbNote: (
    title: string,
    content: string,
    persistToDisk: boolean,
  ) => Promise<void>;
}

function badgeTone(
  status: BridgeConnectionStatus,
): "ready" | "mock" | "error" | "neutral" {
  switch (status) {
    case "ready":
    case "operator":
      return "ready";
    case "mock":
      return "mock";
    case "failed":
      return "error";
    case "connecting":
    case "closed":
      return "neutral";
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, v);
    }
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function metricCell(
  label: string,
  value: string,
  caption?: string,
): HTMLElement {
  const wrap = el("div");
  wrap.append(
    el("div", { class: "card-label" }, label),
    el("div", { class: "metric-value" }, value),
  );
  if (caption) {
    wrap.append(el("div", { class: "metric-caption" }, caption));
  }
  return wrap;
}

export function formatDeviceStatusSummary(
  status: CadenceSessionSnapshot["deviceStatus"],
): string {
  if (!status) {
    return "status not emitted";
  }
  const parts: string[] = [];
  if (status.model) parts.push(status.model);
  parts.push(status.connectType);
  if (status.batteryLevel !== null) parts.push(`${status.batteryLevel}%`);
  if (status.isWearing !== null && status.isWearing !== undefined) {
    parts.push(status.isWearing ? "worn" : "not-worn");
  }
  return parts.join(" · ");
}

export function renderCadenceView(
  root: HTMLElement,
  ctx: CadenceUiContext,
): void {
  const { snapshot, serverInfo } = ctx;
  root.dataset.bridgeMode = snapshot.connectionStatus;

  // Preserve live <video> element across re-renders when Mac webcam stream is active.
  const existingVideo = root.querySelector<HTMLVideoElement>(
    "#cadence-webcam-video",
  );
  root.replaceChildren();

  // Header
  const header = el("header", { class: "header" });
  const titleWrap = el("div");
  titleWrap.append(
    el("h1", { class: "title" }, "Cadence Interview Copilot"),
    el(
      "div",
      { class: "metric-caption" },
      `${serverInfo.providerName} · ${serverInfo.liveApiKeyConfigured ? "Live Gemini Key" : "Offline Mock (set GEMINI_API_KEY in .env.local)"}`,
    ),
  );
  header.append(
    titleWrap,
    el(
      "span",
      { class: "badge", "data-tone": badgeTone(snapshot.connectionStatus) },
      snapshot.modeLabel,
    ),
  );
  root.append(header);

  // Error / mode guidance banner
  if (snapshot.errorMessage) {
    const errCard = el("section", { class: "card" });
    errCard.append(
      el("p", { class: "card-label" }, "Runtime Notice"),
      el("p", { class: "error-banner" }, snapshot.errorMessage),
    );
    const links = el("div", { class: "controls" });
    links.append(
      el(
        "a",
        { class: "button-link accent-link", href: "?role=operator" },
        "Open Mac Operator Station (?role=operator)",
      ),
      el(
        "a",
        { class: "button-link", href: "?mock=1" },
        "Open Mock Bridge (?mock=1)",
      ),
    );
    errCard.append(links);
    root.append(errCard);
  }

  // Telemetry & Status Grid
  const statusCard = el("section", { class: "card" });
  statusCard.append(el("p", { class: "card-label" }, "Copilot Telemetry"));
  const grid = el("div", { class: "grid" });
  const activeTurn = snapshot.domain.activeTurn;
  const groundingText = activeTurn
    ? activeTurn.grounding === "kb"
      ? "[KB] Grounded"
      : "[GEN] Fallback"
    : "Standby";

  grid.append(
    metricCell("Phase", snapshot.domain.phase, snapshot.domain.statusDetail),
    metricCell(
      "Grounding",
      groundingText,
      activeTurn && activeTurn.matchedKbHeadings.length > 0
        ? activeTurn.matchedKbHeadings.join(", ")
        : `${serverInfo.kbDocuments.length} KB doc(s) loaded`,
    ),
    metricCell(
      "Logitech Relay",
      serverInfo.webcamOperatorsConnected > 0
        ? "Mac Cam Armed"
        : "CLI / Standby",
      `${serverInfo.webcamOperatorsConnected} operator tab(s)`,
    ),
    metricCell(
      "Wearable Host",
      ctx.isOperatorRole ? "Mac Browser" : (snapshot.launchSource ?? "WebView"),
      formatDeviceStatusSummary(snapshot.deviceStatus),
    ),
  );
  statusCard.append(grid);
  root.append(statusCard);

  // Mac Operator Webcam Station card (shown in ?role=operator)
  if (ctx.isOperatorRole && ctx.operatorMedia && ctx.operatorMediaState) {
    const camCard = el("section", { class: "card" });
    camCard.append(
      el("p", { class: "card-label" }, "Mac Logitech Webcam & Mic Station"),
      el("p", { class: "metric-caption" }, ctx.operatorMediaState.statusNote),
    );

    const camControls = el("div", { class: "controls" });
    const select = el("select", { class: "input-control" });
    if (ctx.operatorMediaState.devices.length === 0) {
      select.append(el("option", { value: "" }, "Auto-detect Logitech Webcam"));
    } else {
      for (const dev of ctx.operatorMediaState.devices) {
        const opt = el("option", { value: dev.deviceId }, dev.label);
        if (dev.deviceId === ctx.operatorMediaState.selectedDeviceId) {
          opt.selected = true;
        }
        select.append(opt);
      }
    }

    const startCamBtn = el(
      "button",
      { type: "button", class: "accent" },
      ctx.operatorMediaState.webcamActive
        ? "Reconnect Camera"
        : "Connect Logitech Webcam",
    );
    startCamBtn.addEventListener("click", () => {
      void ctx.operatorMedia?.startWebcam(select.value || undefined);
    });

    const snapNowBtn = el(
      "button",
      { type: "button" },
      "Snap Webcam & Answer on G2",
    );
    snapNowBtn.addEventListener("click", () => {
      const frame = ctx.operatorMedia?.captureJpegFrame();
      if (frame) {
        void fetch("/api/cadence/vision-ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: frame.imageBase64,
            mimeType: frame.mimeType,
          }),
        });
      } else {
        void ctx.getController()?.triggerWebcamCapture();
      }
    });

    camControls.append(select, startCamBtn, snapNowBtn);
    if (ctx.operatorMediaState.webcamActive) {
      const stopBtn = el("button", { type: "button" }, "Stop Camera");
      stopBtn.addEventListener("click", () => ctx.operatorMedia?.stopWebcam());
      camControls.append(stopBtn);
    }
    camCard.append(camControls);

    const videoNode =
      existingVideo ??
      el("video", {
        id: "cadence-webcam-video",
        class: "webcam-preview",
        autoplay: "true",
        muted: "true",
        playsinline: "true",
      });
    ctx.operatorMedia.attachVideoElement(videoNode);
    if (!ctx.operatorMediaState.webcamActive) {
      videoNode.style.display = "none";
    } else {
      videoNode.style.display = "block";
    }
    camCard.append(videoNode);
    root.append(camCard);
  }

  // 576x288 Glasses Teleprompter Preview + Ring/Voice Controls
  const hudCard = el("section", { class: "card" });
  hudCard.append(
    el("p", { class: "card-label" }, "576x288 G2 Teleprompter HUD"),
    el("pre", { class: "screen-preview" }, snapshot.screenText),
  );

  // Microphone source selector pills
  const micRow = el("div", { class: "controls" });
  const modes: Array<{ mode: AudioSourceMode; label: string }> = [
    { mode: "g2-mic", label: "Mic: G2 Glasses (16kHz)" },
    { mode: "phone-mic", label: "Mic: iPhone" },
    { mode: "mac-mic", label: "Mic: Mac Station" },
  ];
  for (const item of modes) {
    const active = snapshot.domain.audioSourceMode === item.mode;
    const btn = el(
      "button",
      { type: "button", class: active ? "accent" : "" },
      item.label,
    );
    btn.addEventListener("click", () => {
      ctx.getController()?.setAudioSourceMode(item.mode);
    });
    micRow.append(btn);
  }

  const camToggle = el(
    "button",
    {
      type: "button",
      class: snapshot.attachWebcamOnVoice ? "accent" : "",
    },
    snapshot.attachWebcamOnVoice
      ? "+ Webcam on R1 Hold: ON"
      : "+ Webcam on R1 Hold: OFF",
  );
  camToggle.addEventListener("click", () => {
    ctx.getController()?.setAttachWebcamOnVoice(!snapshot.attachWebcamOnVoice);
  });
  micRow.append(camToggle);
  hudCard.append(micRow);

  // Hold-to-Talk + Webcam + Scroll Controls
  const actionRow = el("div", { class: "controls" });
  const isListening = snapshot.domain.phase === "LISTENING";
  const holdBtn = el(
    "button",
    { type: "button", class: isListening ? "danger-btn" : "accent" },
    isListening
      ? "● Listening... Release to Answer"
      : "Hold to Listen (Mirrors R1 Ring)",
  );

  const startHold = () => {
    if (snapshot.domain.phase !== "LISTENING") {
      ctx.getController()?.dispatchCommand("ring_hold_start", "ui");
    }
  };
  const endHold = () => {
    if (ctx.getController()?.getSnapshot().domain.phase === "LISTENING") {
      ctx.getController()?.dispatchCommand("ring_hold_release", "ui");
    }
  };
  holdBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startHold();
  });
  holdBtn.addEventListener("pointerup", endHold);
  holdBtn.addEventListener("pointercancel", endHold);

  const snapWebcamBtn = el(
    "button",
    { type: "button" },
    "Snap Logitech Webcam",
  );
  snapWebcamBtn.addEventListener("click", () => {
    void ctx.getController()?.triggerWebcamCapture();
  });

  const prevPgBtn = el("button", { type: "button" }, "Prev Page");
  prevPgBtn.addEventListener("click", () => {
    ctx.getController()?.dispatchCommand("scroll_up", "ui");
  });

  const nextPgBtn = el("button", { type: "button" }, "Next Page");
  nextPgBtn.addEventListener("click", () => {
    ctx.getController()?.dispatchCommand("scroll_down", "ui");
  });

  actionRow.append(holdBtn, snapWebcamBtn, prevPgBtn, nextPgBtn);

  if (snapshot.connectionStatus === "ready") {
    const phoneCamBtn = el("button", { type: "button" }, "Phone Camera");
    phoneCamBtn.addEventListener("click", () => {
      void ctx.getController()?.capturePhoneCameraFallback();
    });
    actionRow.append(phoneCamBtn);
  }

  hudCard.append(actionRow);

  // Quick text question bar
  const askForm = el("div", { class: "controls" });
  const askInput = el("input", {
    type: "text",
    class: "input-control grow",
    placeholder: "Type an interview question to test KB vs General fallback...",
  });
  const askBtn = el("button", { type: "button" }, "Ask Copilot");
  const submitTyped = () => {
    const q = askInput.value.trim();
    if (!q) return;
    askInput.value = "";
    void ctx.getController()?.askTextQuestion(q);
  };
  askBtn.addEventListener("click", submitTyped);
  askInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitTyped();
  });
  askForm.append(askInput, askBtn);
  hudCard.append(askForm);
  root.append(hudCard);

  // Latest Answer & Webcam Snapshot Inspector
  if (activeTurn) {
    const turnCard = el("section", { class: "card" });
    turnCard.append(
      el(
        "p",
        { class: "card-label" },
        `Latest Copilot Response · ${activeTurn.grounding === "kb" ? "[KB] Knowledge Base" : "[GEN] General Knowledge"} · ${activeTurn.latencyMs}ms`,
      ),
      el("div", { class: "metric-value" }, `Q: ${activeTurn.transcript}`),
    );
    const bulletList = el("ul", { class: "bullet-list" });
    for (const b of activeTurn.answerBullets) {
      bulletList.append(el("li", undefined, b));
    }
    turnCard.append(bulletList);

    if (activeTurn.webcamThumbnailDataUrl) {
      const thumb = el("img", {
        class: "webcam-thumb",
        src: activeTurn.webcamThumbnailDataUrl,
        alt: "Captured Logitech webcam frame",
      });
      turnCard.append(thumb);
    }
    root.append(turnCard);
  }

  // Knowledge Base Manager Card
  const kbCard = el("section", { class: "card" });
  kbCard.append(
    el(
      "p",
      { class: "card-label" },
      `Knowledge Base Material (${serverInfo.kbDocuments.length} source(s))`,
    ),
    el(
      "p",
      { class: "metric-caption" },
      "Drop .md/.txt files in apps/cadence/kb/ (gitignored) or add prep notes below. Relevant matches show [KB]; unmatched questions answer via [GEN].",
    ),
  );

  const docBadges = el("div", { class: "controls" });
  for (const doc of serverInfo.kbDocuments) {
    docBadges.append(el("span", { class: "badge" }, doc.title));
  }
  kbCard.append(docBadges);

  const kbTitleInput = el("input", {
    type: "text",
    class: "input-control",
    placeholder: "Note title (e.g. Resume Highlights / System Design)",
  });
  const kbContentArea = el("textarea", {
    class: "input-control kb-textarea",
    rows: "4",
    placeholder:
      "## STAR Story: Latency Optimization\n- Cut API p99 from 140ms to 22ms using Redis pipelining...",
  });
  const saveSessionBtn = el(
    "button",
    { type: "button" },
    "Add Session KB Note",
  );
  saveSessionBtn.addEventListener("click", () => {
    if (!kbContentArea.value.trim()) return;
    void ctx.onSaveKbNote(kbTitleInput.value, kbContentArea.value, false);
  });

  const saveDiskBtn = el(
    "button",
    { type: "button", class: "accent" },
    "Save to apps/cadence/kb/",
  );
  saveDiskBtn.addEventListener("click", () => {
    if (!kbContentArea.value.trim()) return;
    void ctx.onSaveKbNote(kbTitleInput.value, kbContentArea.value, true);
  });

  const kbFormWrap = el("div", { class: "kb-form" });
  const kbButtons = el("div", { class: "controls" });
  kbButtons.append(saveSessionBtn, saveDiskBtn);
  kbFormWrap.append(kbTitleInput, kbContentArea, kbButtons);
  kbCard.append(kbFormWrap);
  root.append(kbCard);

  // Sanitized Gesture & Event Log
  const logCard = el("section", { class: "card" });
  const logHeader = el("div", { class: "header" });
  logHeader.append(
    el(
      "p",
      { class: "card-label" },
      `R1 / G2 Gesture Log (${snapshot.domain.events.length})`,
    ),
  );
  if (snapshot.domain.events.length > 0) {
    const clearBtn = el("button", { type: "button" }, "Clear Log");
    clearBtn.addEventListener("click", () =>
      ctx.getController()?.clearEvents(),
    );
    logHeader.append(clearBtn);
  }
  logCard.append(logHeader);

  if (snapshot.domain.events.length === 0) {
    logCard.append(
      el(
        "p",
        { class: "metric-caption" },
        "No gestures logged yet. Hold R1 to record, tap R1 to snap webcam, or swipe R1 to flip pages.",
      ),
    );
  } else {
    const list = el("ul", { class: "event-list" });
    for (const item of snapshot.domain.events) {
      const li = el("li", { class: "event-item" });
      const meta = el("div", { class: "event-meta" });
      meta.append(
        el("span", undefined, `#${item.seq} · ${item.summary}`),
        el("span", undefined, item.timestampIso),
      );
      li.append(meta, el("pre", { class: "event-raw" }, item.rawSanitized));
      list.append(li);
    }
    logCard.append(list);
  }
  root.append(logCard);
}
