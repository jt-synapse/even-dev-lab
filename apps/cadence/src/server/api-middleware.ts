// Local Node/Vite companion API & SSE sync server for Cadence (CAP-014 / ADR-005).
// Coordinates iPhone Even App WebView <-> Mac Operator Station (Logitech webcam + Mac mic + KB + Gemini).

import type { IncomingMessage, ServerResponse } from "node:http";

import type { CopilotTurnResult } from "../domain/copilot.ts";
import {
  GeminiInteractionsProvider,
  MockCopilotProvider,
  type CopilotAiProvider,
} from "./ai-provider.ts";
import type { KnowledgeBaseStore } from "./kb-store.ts";
import {
  captureMacLogitechWebcam,
  type CapturedWebcamFrame,
} from "./webcam-service.ts";

export interface CadenceServerEvent {
  readonly type:
    | "connected"
    | "status"
    | "turn_result"
    | "capture_webcam_request"
    | "mac_mic_start"
    | "mac_mic_stop"
    | "kb_updated"
    | "error";
  readonly payload: Record<string, unknown>;
}

export interface CreateCadenceApiOptions {
  readonly kbStore: KnowledgeBaseStore;
  readonly provider?: CopilotAiProvider;
  readonly allowSyntheticWebcamFallback?: boolean;
}

const MAX_BODY_BYTES = 12 * 1024 * 1024; // 12 MB ceiling for WAV audio or webcam JPEG

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += buf.byteLength;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request payload exceeded 12MB limit."));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => {
      if (total === 0) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
        } else {
          resolve({});
        }
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });

    req.on("error", (err) => reject(err));
  });
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

export function resolveDefaultProvider(): CopilotAiProvider {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (apiKey.length > 0) {
    return new GeminiInteractionsProvider({
      apiKey,
      model: process.env.CADENCE_GEMINI_MODEL,
      sttModel: process.env.CADENCE_STT_MODEL,
    });
  }
  return new MockCopilotProvider();
}

export function createCadenceApiHandler(options: CreateCadenceApiOptions) {
  const provider = options.provider ?? resolveDefaultProvider();
  const allowSyntheticWebcam = options.allowSyntheticWebcamFallback ?? true;

  const sseClients = new Set<{
    res: ServerResponse;
    role: string;
    hasWebcam: boolean;
  }>();

  const pendingWebcamRequests = new Map<
    string,
    {
      resolve: (frame: CapturedWebcamFrame) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  let latestTurn: CopilotTurnResult | null = null;
  let turnCounter = 1;

  const broadcast = (event: CadenceServerEvent): void => {
    const wire = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(wire);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  const countWebcamOperators = (): number => {
    let count = 0;
    for (const c of sseClients) {
      if (c.hasWebcam) count += 1;
    }
    return count;
  };

  const relayHooks = {
    hasActiveWebcamOperator: () => countWebcamOperators() > 0,
    requestOperatorFrame: (timeoutMs: number) =>
      new Promise<CapturedWebcamFrame>((resolve, reject) => {
        const requestId = `cam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const timer = setTimeout(() => {
          pendingWebcamRequests.delete(requestId);
          reject(new Error("Mac Operator webcam frame timed out."));
        }, timeoutMs);
        pendingWebcamRequests.set(requestId, { resolve, reject, timer });
        broadcast({
          type: "capture_webcam_request",
          payload: { requestId },
        });
      }),
  };

  return async function handleCadenceRequest(
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void,
  ): Promise<void> {
    const rawUrl = req.url ?? "/";
    const parsedUrl = new URL(rawUrl, "http://127.0.0.1");
    const pathname = parsedUrl.pathname;

    if (!pathname.startsWith("/api/cadence/")) {
      if (next) {
        next();
        return;
      }
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    try {
      // SSE real-time bridge between iPhone WebView and Mac Operator tab
      if (req.method === "GET" && pathname === "/api/cadence/events") {
        const role = parsedUrl.searchParams.get("role") ?? "phone";
        const hasWebcam = parsedUrl.searchParams.get("webcam") === "1";

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        const client = { res, role, hasWebcam };
        sseClients.add(client);

        const initialEvent: CadenceServerEvent = {
          type: "connected",
          payload: {
            providerName: provider.name,
            liveApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
            webcamOperatorsConnected: countWebcamOperators(),
            latestTurn,
          },
        };
        res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);

        req.on("close", () => {
          sseClients.delete(client);
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/cadence/state") {
        const docs = options.kbStore.listDocuments();
        sendJson(res, 200, {
          ok: true,
          providerName: provider.name,
          liveApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
          webcamOperatorsConnected: countWebcamOperators(),
          kbDocumentCount: docs.length,
          latestTurn,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/cadence/kb") {
        const docs = options.kbStore.listDocuments();
        sendJson(res, 200, {
          ok: true,
          documents: docs,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/cadence/kb") {
        const body = await readJsonBody(req);
        const title = typeof body.title === "string" ? body.title : "";
        const content = typeof body.content === "string" ? body.content : "";
        const persist = body.persistToDisk === true;
        if (!content.trim()) {
          sendJson(res, 400, { ok: false, error: "Note content is required." });
          return;
        }
        const saved = options.kbStore.upsertNote(title, content, persist);
        const docs = options.kbStore.listDocuments();
        broadcast({
          type: "kb_updated",
          payload: { documentCount: docs.length, savedTitle: saved.title },
        });
        sendJson(res, 200, { ok: true, document: saved, documents: docs });
        return;
      }

      // Mac Operator Station webcam readiness registration
      if (req.method === "POST" && pathname === "/api/cadence/operator-frame") {
        const body = await readJsonBody(req);
        const requestId =
          typeof body.requestId === "string" ? body.requestId : "";
        const imageBase64 =
          typeof body.imageBase64 === "string" ? body.imageBase64 : "";
        const mimeType =
          typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
        const sourceLabel =
          typeof body.sourceLabel === "string"
            ? body.sourceLabel
            : "Mac Operator Logitech WebRTC";

        const pending = pendingWebcamRequests.get(requestId);
        if (pending && imageBase64) {
          clearTimeout(pending.timer);
          pendingWebcamRequests.delete(requestId);
          pending.resolve({ imageBase64, mimeType, sourceLabel });
          sendJson(res, 200, { ok: true });
          return;
        }
        sendJson(res, 400, {
          ok: false,
          error: "No matching pending webcam capture request.",
        });
        return;
      }

      // Remote Mac Mic start/stop relay when R1 ring is held in `mac-mic` mode
      if (req.method === "POST" && pathname === "/api/cadence/mac-mic/start") {
        broadcast({
          type: "mac_mic_start",
          payload: { startedAt: Date.now() },
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && pathname === "/api/cadence/mac-mic/stop") {
        broadcast({ type: "mac_mic_stop", payload: { stoppedAt: Date.now() } });
        sendJson(res, 200, { ok: true });
        return;
      }

      // Voice Hold-to-Release -> STT -> KB/LLM Answer
      if (req.method === "POST" && pathname === "/api/cadence/audio-ask") {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const audioWavBase64 =
          typeof body.audioWavBase64 === "string" ? body.audioWavBase64 : "";
        const mimeType =
          typeof body.mimeType === "string" ? body.mimeType : "audio/wav";
        const hintTranscript =
          typeof body.hintTranscript === "string"
            ? body.hintTranscript
            : undefined;
        const attachWebcam = body.attachWebcam === true;

        if (!audioWavBase64 && !hintTranscript) {
          sendJson(res, 400, {
            ok: false,
            error: "audioWavBase64 or hintTranscript is required.",
          });
          return;
        }

        broadcast({
          type: "status",
          payload: {
            detail: "Transcribing speech & querying Knowledge Base...",
          },
        });

        let webcamFrame: CapturedWebcamFrame | null = null;
        if (attachWebcam) {
          webcamFrame = await captureMacLogitechWebcam({
            relay: relayHooks,
            allowSyntheticFallback: allowSyntheticWebcam,
          });
        }

        const documents = options.kbStore.listDocuments();
        const aiResult = await provider.transcribeAndAnswerAudio({
          audioWavBase64,
          mimeType,
          hintTranscript,
          webcamImageBase64: webcamFrame?.imageBase64,
          webcamMimeType: webcamFrame?.mimeType,
          documents,
        });

        const turn: CopilotTurnResult = {
          turnId: `turn-${turnCounter++}-${Date.now()}`,
          trigger: webcamFrame ? "webcam" : "voice",
          transcript: aiResult.transcript,
          answerBullets: aiResult.answerBullets,
          grounding: aiResult.grounding,
          matchedKbHeadings: aiResult.matchedKbHeadings,
          providerName: aiResult.providerName,
          latencyMs: Math.max(1, Date.now() - startedAt),
          webcamThumbnailDataUrl: webcamFrame
            ? `data:${webcamFrame.mimeType};base64,${webcamFrame.imageBase64}`
            : null,
        };
        latestTurn = turn;
        broadcast({ type: "turn_result", payload: { turn } });
        sendJson(res, 200, { ok: true, turn });
        return;
      }

      // Logitech Webcam Snapshot -> Vision + KB/LLM Answer
      if (req.method === "POST" && pathname === "/api/cadence/vision-ask") {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const prompt =
          typeof body.prompt === "string" ? body.prompt : undefined;
        const inlineBase64 =
          typeof body.imageBase64 === "string" ? body.imageBase64 : "";
        const inlineMime =
          typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";

        broadcast({
          type: "status",
          payload: {
            detail: "Capturing Logitech webcam & running Gemini Vision...",
          },
        });

        const frame: CapturedWebcamFrame = inlineBase64
          ? {
              imageBase64: inlineBase64,
              mimeType: inlineMime,
              sourceLabel: "uploaded-frame",
            }
          : await captureMacLogitechWebcam({
              relay: relayHooks,
              allowSyntheticFallback: allowSyntheticWebcam,
            });

        const documents = options.kbStore.listDocuments();
        const aiResult = await provider.analyzeWebcamAndAnswer({
          imageBase64: frame.imageBase64,
          mimeType: frame.mimeType,
          prompt,
          documents,
        });

        const turn: CopilotTurnResult = {
          turnId: `turn-${turnCounter++}-${Date.now()}`,
          trigger: "webcam",
          transcript: aiResult.transcript,
          answerBullets: aiResult.answerBullets,
          grounding: aiResult.grounding,
          matchedKbHeadings: aiResult.matchedKbHeadings,
          providerName: `${aiResult.providerName} · ${frame.sourceLabel}`,
          latencyMs: Math.max(1, Date.now() - startedAt),
          webcamThumbnailDataUrl: `data:${frame.mimeType};base64,${frame.imageBase64}`,
        };
        latestTurn = turn;
        broadcast({ type: "turn_result", payload: { turn } });
        sendJson(res, 200, { ok: true, turn });
        return;
      }

      // Typed text question -> KB/LLM Answer (useful for prep testing & UI)
      if (req.method === "POST" && pathname === "/api/cadence/text-ask") {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const question =
          typeof body.question === "string" ? body.question.trim() : "";
        if (!question) {
          sendJson(res, 400, { ok: false, error: "question is required." });
          return;
        }

        const documents = options.kbStore.listDocuments();
        const aiResult = await provider.answerTextQuestion({
          question,
          documents,
        });

        const turn: CopilotTurnResult = {
          turnId: `turn-${turnCounter++}-${Date.now()}`,
          trigger: "text",
          transcript: aiResult.transcript,
          answerBullets: aiResult.answerBullets,
          grounding: aiResult.grounding,
          matchedKbHeadings: aiResult.matchedKbHeadings,
          providerName: aiResult.providerName,
          latencyMs: Math.max(1, Date.now() - startedAt),
          webcamThumbnailDataUrl: null,
        };
        latestTurn = turn;
        broadcast({ type: "turn_result", payload: { turn } });
        sendJson(res, 200, { ok: true, turn });
        return;
      }

      sendJson(res, 404, { ok: false, error: `Unknown endpoint ${pathname}` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      broadcast({ type: "error", payload: { message } });
      sendJson(res, 500, { ok: false, error: message });
    }
  };
}
