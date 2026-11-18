import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyCadenceInput,
  applyCadenceTurnResult,
  createInitialCadenceState,
  formatCadenceGlassesScreen,
  type CopilotTurnResult,
} from "../src/domain/copilot.ts";
import {
  retrieveRelevantKbChunks,
  type KnowledgeDocument,
} from "../src/domain/knowledge-base.ts";
import {
  encodeBytesToBase64,
  encodePcm16LeToWav,
  estimatePcmDurationSeconds,
  WAV_HEADER_BYTES,
} from "../src/domain/wav.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const sampleKbPath = join(
  testDir,
  "..",
  "..",
  "..",
  "fixtures",
  "cadence-kb-sample.md",
);
const sampleDocs: KnowledgeDocument[] = [
  {
    id: "sample",
    title: "Candidate KB",
    content: readFileSync(sampleKbPath, "utf8"),
  },
];

test("encodePcm16LeToWav writes valid 16kHz 16-bit mono RIFF/WAVE header and aligns odd trailing byte", () => {
  const chunkA = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
  const chunkB = new Uint8Array([0x05, 0x06, 0xff]); // 3 bytes -> 1 odd byte trimmed
  const wav = encodePcm16LeToWav([chunkA, chunkB], 16000, 1);

  assert.equal(wav.byteLength, WAV_HEADER_BYTES + 6);
  const riff = String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!);
  const wave = String.fromCharCode(wav[8]!, wav[9]!, wav[10]!, wav[11]!);
  assert.equal(riff, "RIFF");
  assert.equal(wave, "WAVE");

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 6);

  const b64 = encodeBytesToBase64(wav);
  assert.equal(Buffer.from(b64, "base64").equals(Buffer.from(wav)), true);
  assert.equal(estimatePcmDurationSeconds(32000, 16000, 1), 1);
});

test("retrieveRelevantKbChunks distinguishes Knowledge Base matches ([KB]) from general fallback ([GEN])", () => {
  const kbHit = retrieveRelevantKbChunks(
    "Tell me about a time you solved payment webhook retry storms and PostgreSQL idempotency",
    sampleDocs,
    2,
  );
  assert.equal(kbHit.hasRelevantMatch, true);
  assert.ok(kbHit.matchedChunks.length >= 1);
  assert.match(kbHit.matchedChunks[0]!.chunk.heading, /Incident Recovery/i);

  const generalMiss = retrieveRelevantKbChunks(
    "Explain Red-Black binary search tree rotation invariants in C++",
    sampleDocs,
    2,
  );
  assert.equal(generalMiss.hasRelevantMatch, false);
  assert.equal(generalMiss.matchedChunks.length, 0);
});

test("R1 hold -> audio chunks -> release -> multi-page answer scrolls cleanly within 9 G2 lines", () => {
  let state = createInitialCadenceState("g2-mic");

  const hold = applyCadenceInput(state, {
    command: "ring_hold_start",
    origin: "ring",
    timestampIso: "2026-11-17T21:00:00.000Z",
    summary: "sys ring_hold_start via ring",
    rawSanitized: '{"sysEvent":{"eventType":9,"eventSource":2}}',
  });
  assert.equal(hold.sideEffect, "start_audio_capture");
  state = hold.state;
  assert.equal(state.phase, "LISTENING");

  const pcmStep = applyCadenceInput(state, {
    command: "audio_chunk_received",
    origin: "unknown",
    timestampIso: "2026-11-17T21:00:01.000Z",
    summary: "pcm 32000B",
    rawSanitized: '{"audioEvent":{"pcmBytes":32000}}',
    pcmBytes: 32000,
  });
  state = pcmStep.state;
  assert.equal(state.activeRecordingSeconds, 1);

  const release = applyCadenceInput(state, {
    command: "ring_hold_release",
    origin: "ring",
    timestampIso: "2026-11-17T21:00:01.500Z",
    summary: "sys ring_hold_release via ring",
    rawSanitized: '{"sysEvent":{"eventType":10,"eventSource":2}}',
  });
  assert.equal(release.sideEffect, "stop_and_submit_audio");
  state = release.state;
  assert.equal(state.phase, "TRANSCRIBING");

  const longTurn: CopilotTurnResult = {
    turnId: "turn-1",
    trigger: "voice",
    transcript:
      "How did you eliminate payment webhook retry storms during peak load?",
    answerBullets: [
      "Introduced deterministic PostgreSQL idempotency keys on every webhook.",
      "Partitioned outbox workers with exponential backoff and circuit-breaker jitter.",
      "Cut webhook timeout rate from 4.0% down to 0.01% across 12M daily events.",
      "Eliminated on-call paging storms during zero-downtime migration.",
      "Validated throughput at 42,000 events/sec with p99 under 18ms.",
    ],
    grounding: "kb",
    matchedKbHeadings: ["STAR Story: Incident Recovery"],
    providerName: "gemini (gemini-4-hydrogen)",
    latencyMs: 420,
  };

  state = applyCadenceTurnResult(state, longTurn);
  assert.equal(state.phase, "ANSWER_READY");
  assert.ok(state.answerPages.length >= 2);

  const page1Screen = formatCadenceGlassesScreen(state);
  assert.match(page1Screen, /CADENCE \[KB\] MIC · P1\//);
  assert.ok(
    page1Screen.split("\n").length <= 9,
    "G2 page must fit <= 9 LVGL lines",
  );

  const scrollDown = applyCadenceInput(state, {
    command: "scroll_down",
    origin: "unknown",
    timestampIso: "2026-11-17T21:00:03.000Z",
    summary: "scroll_down",
    rawSanitized: '{"textEvent":{"eventType":2}}',
  });
  state = scrollDown.state;
  assert.equal(state.answerPageIndex, 1);
  const page2Screen = formatCadenceGlassesScreen(state);
  assert.match(page2Screen, /CADENCE \[KB\] MIC · P2\//);
  assert.ok(page2Screen.split("\n").length <= 9);
});
