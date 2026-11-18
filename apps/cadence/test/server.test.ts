import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { encodeBytesToBase64, encodePcm16LeToWav } from "../src/domain/wav.ts";
import { GeminiInteractionsProvider } from "../src/server/ai-provider.ts";
import { createCadenceApiHandler } from "../src/server/api-middleware.ts";
import { createKnowledgeBaseStore } from "../src/server/kb-store.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sampleFixturePath = join(repoRoot, "fixtures", "cadence-kb-sample.md");

test("GeminiInteractionsProvider posts v1 Interactions payloads with thinking_level=low and distinguishes KB vs General", async () => {
  const capturedRequests: Array<{
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    capturedRequests.push({ url, headers, body });

    const model = String(body.model ?? "");
    const responseText = model.includes("transcribe")
      ? "How did you fix payment webhook retry storms?"
      : "- Added deterministic PostgreSQL idempotency keys.\n- Cut timeout rate from 4.0% to 0.01%.";

    return new Response(
      JSON.stringify({
        id: "inter-123",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text: responseText }],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const kbStore = createKnowledgeBaseStore({
    kbDir: join(testDir, "__nonexistent_kb__"),
    sampleFixturePath,
  });

  const provider = new GeminiInteractionsProvider({
    apiKey: "test-key-never-logged",
    model: "gemini-4-hydrogen",
    sttModel: "gemini-3.5-transcribe",
    fetchFn: fakeFetch,
  });

  const wavB64 = encodeBytesToBase64(
    encodePcm16LeToWav([new Uint8Array([1, 2, 3, 4])]),
  );
  const res = await provider.transcribeAndAnswerAudio({
    audioWavBase64: wavB64,
    documents: kbStore.listDocuments(),
  });

  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[0]?.body.model, "gemini-3.5-transcribe");
  assert.equal(capturedRequests[0]?.headers["Api-Revision"], "2026-05-20");
  assert.equal(capturedRequests[1]?.body.model, "gemini-4-hydrogen");
  assert.deepEqual(capturedRequests[1]?.body.generation_config, {
    thinking_level: "low",
  });
  assert.equal(res.grounding, "kb");
  assert.equal(res.answerBullets.length, 2);
});

test("Cadence API middleware serves KB, audio-ask ([KB] + [GEN]), and vision-ask over HTTP", async () => {
  const kbStore = createKnowledgeBaseStore({
    kbDir: join(testDir, "__nonexistent_kb__"),
    sampleFixturePath,
  });
  const handler = createCadenceApiHandler({
    kbStore,
    allowSyntheticWebcamFallback: true,
  });

  const server = createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. State endpoint
    const stateRes = await fetch(`${base}/api/cadence/state`);
    const stateJson = (await stateRes.json()) as {
      ok: boolean;
      kbDocumentCount: number;
    };
    assert.equal(stateJson.ok, true);
    assert.ok(stateJson.kbDocumentCount >= 1);

    // 2. Audio ask matching KB -> [KB]
    const wavB64 = encodeBytesToBase64(
      encodePcm16LeToWav([new Uint8Array(64)]),
    );
    const kbTurnRes = await fetch(`${base}/api/cadence/audio-ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioWavBase64: wavB64,
        hintTranscript: "Tell me about payment webhook retry storms",
      }),
    });
    const kbTurnJson = (await kbTurnRes.json()) as {
      ok: boolean;
      turn: { grounding: string; answerBullets: string[] };
    };
    assert.equal(kbTurnJson.ok, true);
    assert.equal(kbTurnJson.turn.grounding, "kb");
    assert.ok(kbTurnJson.turn.answerBullets.length >= 1);

    // 3. Audio ask with no KB relevance -> [GEN] fallback
    const genTurnRes = await fetch(`${base}/api/cadence/audio-ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioWavBase64: wavB64,
        hintTranscript: "Explain Dijkstra shortest path heap complexity",
      }),
    });
    const genTurnJson = (await genTurnRes.json()) as {
      ok: boolean;
      turn: { grounding: string };
    };
    assert.equal(genTurnJson.ok, true);
    assert.equal(genTurnJson.turn.grounding, "general");

    // 4. Vision ask (Logitech webcam synthetic fallback)
    const visionRes = await fetch(`${base}/api/cadence/vision-ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Analyze binary tree level-order traversal code on whiteboard",
      }),
    });
    const visionJson = (await visionRes.json()) as {
      ok: boolean;
      turn: {
        trigger: string;
        grounding: string;
        webcamThumbnailDataUrl: string | null;
      };
    };
    assert.equal(visionJson.ok, true);
    assert.equal(visionJson.turn.trigger, "webcam");
    assert.equal(visionJson.turn.grounding, "general");
    assert.match(visionJson.turn.webcamThumbnailDataUrl ?? "", /^data:image\//);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
