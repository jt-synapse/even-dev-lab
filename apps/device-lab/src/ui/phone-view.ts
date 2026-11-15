// Phone WebView diagnostic inspector (blueprint §3 & §9).
// Vanilla TypeScript DOM rendering using Even Hub phone dark-theme tokens.

import type {
  BridgeConnectionStatus,
  DiagnosticSessionController,
  DiagnosticSessionSnapshot,
} from "../even/adapter.ts";

function badgeTone(
  status: BridgeConnectionStatus,
): "ready" | "mock" | "error" | "neutral" {
  switch (status) {
    case "ready":
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
  status: DiagnosticSessionSnapshot["deviceStatus"],
): string {
  if (!status) {
    return "status not emitted";
  }
  const parts: string[] = [];
  if (status.model) {
    parts.push(status.model);
  }
  parts.push(status.connectType);
  if (status.batteryLevel !== null) {
    parts.push(`${status.batteryLevel}%`);
  }
  if (status.isWearing !== null && status.isWearing !== undefined) {
    parts.push(status.isWearing ? "worn" : "not-worn");
  }
  if (status.isCharging) {
    parts.push("charging");
  }
  if (status.isInCase) {
    parts.push("in-case");
  }
  return parts.join(" · ");
}

export function renderPhoneDiagnosticView(
  root: HTMLElement,
  snapshot: DiagnosticSessionSnapshot,
  getController: () => DiagnosticSessionController | null,
): void {
  root.dataset.bridgeMode = snapshot.connectionStatus;
  root.replaceChildren();

  const header = el("header", { class: "header" });
  header.append(
    el("h1", { class: "title" }, "Even Device Lab"),
    el(
      "span",
      {
        class: "badge",
        "data-tone": badgeTone(snapshot.connectionStatus),
      },
      snapshot.modeLabel,
    ),
  );
  root.append(header);

  if (snapshot.errorMessage) {
    const errCard = el("section", { class: "card" });
    errCard.append(
      el("p", { class: "card-label" }, "Bridge Diagnostic"),
      el("p", { class: "error-banner" }, snapshot.errorMessage),
    );
    const controls = el("div", { class: "controls" });
    controls.append(
      el(
        "a",
        { class: "button-link", href: "?mock=1" },
        "Inspect UI in Mock Mode (?mock=1)",
      ),
    );
    errCard.append(controls);
    root.append(errCard);
  }

  const statusCard = el("section", { class: "card" });
  statusCard.append(el("p", { class: "card-label" }, "Session Telemetry"));
  const grid = el("div", { class: "grid" });
  grid.append(
    metricCell("Phase", snapshot.domain.phase, snapshot.domain.lifecycle),
    metricCell("Taps", String(snapshot.domain.tapCount), "Deterministic step"),
    metricCell(
      "Scroll",
      `^${snapshot.domain.scrollUpCount} / v${snapshot.domain.scrollDownCount}`,
      `Row ${snapshot.domain.focusIndex + 1} of 3`,
    ),
    metricCell(
      "Host Context",
      snapshot.launchSource ?? "n/a",
      formatDeviceStatusSummary(snapshot.deviceStatus),
    ),
  );
  statusCard.append(grid);
  root.append(statusCard);

  const previewCard = el("section", { class: "card" });
  previewCard.append(
    el("p", { class: "card-label" }, "576x288 Glasses Container Payload"),
    el("pre", { class: "screen-preview" }, snapshot.screenText),
  );

  if (snapshot.connectionStatus === "mock") {
    const mockControls = el("div", { class: "controls" });
    const tapBtn = el(
      "button",
      { type: "button", class: "accent" },
      "Mock Tap",
    );
    tapBtn.addEventListener("click", () => {
      getController()?.injectMockInput("tap", "none");
    });
    const upBtn = el("button", { type: "button" }, "Mock Scroll Up");
    upBtn.addEventListener("click", () => {
      getController()?.injectMockInput("scroll_up", "none");
    });
    const downBtn = el("button", { type: "button" }, "Mock Scroll Down");
    downBtn.addEventListener("click", () => {
      getController()?.injectMockInput("scroll_down", "none");
    });
    const liveLink = el(
      "a",
      { class: "button-link", href: "?" },
      "Exit Mock Mode",
    );
    mockControls.append(tapBtn, upBtn, downBtn, liveLink);
    previewCard.append(mockControls);
  }
  root.append(previewCard);

  const logCard = el("section", { class: "card" });
  const logHeader = el("div", { class: "header" });
  logHeader.append(
    el(
      "p",
      { class: "card-label" },
      `Normalized Input Log (${snapshot.domain.events.length})`,
    ),
  );
  if (snapshot.domain.events.length > 0) {
    const clearBtn = el("button", { type: "button" }, "Clear Log");
    clearBtn.addEventListener("click", () => {
      getController()?.clearEvents();
    });
    logHeader.append(clearBtn);
  }
  logCard.append(logHeader);

  if (snapshot.domain.events.length === 0) {
    logCard.append(
      el(
        "p",
        { class: "metric-caption" },
        "No input events captured yet. Trigger tap or scroll from simulator or G2/R1.",
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
