import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { CopilotTurnResult } from "../src/domain/copilot.ts";
import { encodeBytesToBase64, encodePcm16LeToWav } from "../src/domain/wav.ts";
import { GeminiInteractionsProvider } from "../src/server/ai-provider.ts";
import { createCadenceApiHandler } from "../src/server/api-middleware.ts";
import { createKnowledgeBaseStore } from "../src/server/kb-store.ts";
import { createTypedSessionStore } from "../src/server/typed-session-store.ts";

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
  assert.equal(
    (
      capturedRequests[0]?.body.input as Array<{
        type: string;
        content: unknown[];
      }>
    )?.[0]?.type,
    "user_input",
  );
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

async function startTypedCompanion(
  dbPath: string,
  respond: (input: string) => string | Promise<string>,
) {
  const store = createTypedSessionStore(dbPath);
  const provider = new GeminiInteractionsProvider({
    apiKey: "test-key",
    fetchFn: async (_url, init) => {
      const { input } = JSON.parse(String(init?.body)) as { input: string };
      return Response.json({ output_text: await respond(input) });
    },
  });
  const kbStore = createKnowledgeBaseStore({
    kbDir: join(testDir, "__nonexistent_kb__"),
    sampleFixturePath,
  });
  const handler = createCadenceApiHandler({
    kbStore,
    provider,
    typedSessionStore: store,
  });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const post = (route: string, body: Record<string, unknown>) =>
    fetch(`http://127.0.0.1:${port}/api/cadence/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

  return {
    server,
    post,
    async ask(question: string, requestId?: string) {
      const response = await post("text-ask", { question, requestId });
      const body = (await response.json()) as {
        turn: CopilotTurnResult;
        error?: string;
      };
      assert.equal(response.status, 200, body.error);
      return body.turn;
    },
    async [Symbol.asyncDispose]() {
      await server[Symbol.asyncDispose]();
      store.close();
    },
  };
}

test("typed follow-ups retain the problem, candidate correction and attributed suggestion across a companion restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-typed-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "sessions.sqlite");
  const problem =
    "Find duplicates in an integer array. Keep the input array unchanged.";
  const correction = "I sorted a copy instead.";
  const suggestion = "Use a hash map to count occurrences.";
  const followup = "What is the runtime of my version?";
  const requestId = randomUUID();
  let original: CopilotTurnResult;
  {
    await using first = await startTypedCompanion(dbPath, (input) =>
      input === problem ? suggestion : "Scan adjacent entries.",
    );
    original = await first.ask(problem, requestId);
    const updated = await first.ask(correction);
    assert.ok(original.sessionId && original.problemId && original.turnId);
    assert.equal(updated.sessionId, original.sessionId);
    assert.equal(updated.problemId, original.problemId);
    assert.notEqual(updated.turnId, original.turnId);
  }

  const inputs: string[] = [];
  await using resumed = await startTypedCompanion(dbPath, (input) => {
    inputs.push(input);
    return "Sorting the copy takes O(n log n).";
  });
  assert.deepEqual(await resumed.ask(problem, requestId), original);
  assert.equal(
    inputs.length,
    0,
    "a redelivered request must reuse the stored result",
  );

  const turn = await resumed.ask(followup);
  assert.equal(turn.transcript, followup);
  assert.equal(turn.sessionId, original.sessionId);
  assert.equal(turn.problemId, original.problemId);
  const context = JSON.parse(inputs[0]!) as {
    originalProblem: string;
    recentExchanges: Array<{ user: string; cadenceSuggestion: string }>;
    currentQuestion: string;
  };
  assert.equal(context.originalProblem, problem);
  assert.ok(context.recentExchanges.some((item) => item.user === correction));
  assert.ok(
    context.recentExchanges.some((item) =>
      item.cadenceSuggestion.includes(suggestion),
    ),
  );
  assert.equal(context.currentQuestion, followup);

  // Move the correction out of the recent-turn window, as in a longer practice session.
  for (let i = 1; i <= 8; i++) {
    await resumed.ask(`Walk through example ${i}.`);
  }
  await resumed.ask("Does my implementation preserve the input?");
  const later = JSON.parse(inputs.at(-1)!) as {
    originalProblem: string;
    earlierUserExcerpts: Array<{ user: string }>;
  };
  assert.equal(later.originalProblem, problem);
  assert.ok(later.earlierUserExcerpts.some((item) => item.user === correction));

  assert.equal((await resumed.post("typed-session/new", {})).ok, true);
  const fresh = await resumed.ask("How do I traverse a graph?");
  assert.notEqual(fresh.sessionId, original.sessionId);
  assert.notEqual(fresh.problemId, original.problemId);
  assert.equal(inputs.at(-1), "How do I traverse a graph?");
});

test(
  "overlapping typed asks see committed turns in submission order, and a failed ask can be retried",
  { timeout: 10000 },
  async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const inputs: string[] = [];
    let failNext = false;
    await using companion = await startTypedCompanion(
      ":memory:",
      async (input) => {
        inputs.push(input);
        if (inputs.length === 1) {
          entered.resolve();
          await release.promise;
        }
        if (failNext) {
          failNext = false;
          throw new Error("provider briefly unavailable");
        }
        return "Use the midpoint invariant.";
      },
    );

    const first = companion.ask("Implement a binary search.");
    await entered.promise;
    const secondBodyReceived = new Promise<void>((resolve) =>
      companion.server.once("request", (req) => req.once("end", resolve)),
    );
    const second = companion.ask("What is its loop invariant?");
    try {
      await secondBodyReceived;
    } finally {
      release.resolve();
    }
    await Promise.all([first, second]);
    assert.equal(inputs.length, 2);
    assert.match(inputs[1]!, /Implement a binary search/);
    assert.match(inputs[1]!, /Use the midpoint invariant/);

    const requestId = randomUUID();
    const question = "Can it handle duplicates?";
    failNext = true;
    assert.equal(
      (await companion.post("text-ask", { question, requestId })).status,
      500,
    );
    const retried = await companion.ask(question, requestId);
    assert.equal(retried.transcript, question);
    assert.equal(
      inputs[2],
      inputs[3],
      "a failed turn must not enter the next prompt",
    );
    assert.deepEqual(await companion.ask(question, requestId), retried);
    assert.equal(
      inputs.length,
      4,
      "retrying the successful request must not call Gemini again",
    );
  },
);
