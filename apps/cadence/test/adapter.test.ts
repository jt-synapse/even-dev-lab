import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AudioEvent,
  AudioInputSource,
  EventSourceType,
  MenuItemClickEvent,
  OsEventTypeList,
  StartUpPageCreateResult,
  Sys_ItemEvent,
  validateEvenHubPageContainer,
  type CreateStartUpPageContainer,
  type DeviceInfo,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";

import type { CopilotTurnResult } from "../src/domain/copilot.ts";
import {
  MENU_SNAP_WEBCAM_ID,
  normalizeCadenceEvenHubEvent,
  startCadenceSession,
  type CadenceBackendClient,
  type CadenceSessionSnapshot,
  type EvenBridgeTransport,
} from "../src/even/adapter.ts";

class FakeCadenceBridge implements EvenBridgeTransport {
  startupPayloads: CreateStartUpPageContainer[] = [];
  upgrades: string[] = [];
  audioCalls: Array<{ isOpen: boolean; source?: AudioInputSource }> = [];
  shutdownModes: Array<number | undefined> = [];
  unsubscribedCount = 0;

  private eventListener: ((event: EvenHubEvent) => void) | null = null;

  async createStartUpPageContainer(
    container: CreateStartUpPageContainer,
  ): Promise<StartUpPageCreateResult> {
    const check = validateEvenHubPageContainer(container);
    assert.equal(
      check.valid,
      true,
      "Startup container must pass SDK validator",
    );
    this.startupPayloads.push(container);
    return StartUpPageCreateResult.success;
  }

  async textContainerUpgrade(container: {
    content?: string;
  }): Promise<boolean> {
    this.upgrades.push(container.content ?? "");
    return true;
  }

  async audioControl(
    isOpen: boolean,
    source?: AudioInputSource,
  ): Promise<boolean> {
    this.audioCalls.push({ isOpen, source });
    return true;
  }

  async shutDownPageContainer(exitMode?: number): Promise<boolean> {
    this.shutdownModes.push(exitMode);
    return true;
  }

  async getDeviceInfo(): Promise<DeviceInfo | null> {
    return null;
  }

  onEvenHubEvent(callback: (event: EvenHubEvent) => void): () => void {
    this.eventListener = callback;
    return () => {
      this.unsubscribedCount += 1;
      this.eventListener = null;
    };
  }

  onLaunchSource(): () => void {
    return () => {
      this.unsubscribedCount += 1;
    };
  }

  onDeviceStatusChanged(): () => void {
    return () => {
      this.unsubscribedCount += 1;
    };
  }

  emitEvent(event: EvenHubEvent): void {
    this.eventListener?.(event);
  }
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

test("normalizeCadenceEvenHubEvent handles R1 ring wire clicks, long-presses, and menu actions", () => {
  // Wire click omits CLICK_EVENT=0 on sysEvent
  const wireTap = normalizeCadenceEvenHubEvent(
    {
      sysEvent: new Sys_ItemEvent({
        eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
      }),
    },
    "2026-11-17T21:00:00.000Z",
  );
  assert.equal(wireTap.command, "trigger_webcam_capture");
  assert.equal(wireTap.origin, "ring");

  const menuCam = normalizeCadenceEvenHubEvent(
    {
      menuItemClickEvent: new MenuItemClickEvent({
        itemID: MENU_SNAP_WEBCAM_ID,
      }),
    },
    "2026-11-17T21:00:01.000Z",
  );
  assert.equal(menuCam.command, "trigger_webcam_capture");
});

test("R1 ring hold-to-release opens G2 16kHz mic, encodes RIFF WAV, submits to backend, and updates G2 HUD", async () => {
  const fakeBridge = new FakeCadenceBridge();
  const capturedWavPayloads: string[] = [];
  let webcamCalls = 0;
  let macMicStarts = 0;
  let macMicStops = 0;

  const fakeBackend: CadenceBackendClient = {
    async submitAudioTurn(params) {
      capturedWavPayloads.push(params.audioWavBase64);
      const turn: CopilotTurnResult = {
        turnId: "turn-voice-1",
        trigger: "voice",
        transcript: "Walk me through your Kafka migration.",
        answerBullets: [
          "Migrated streaming pipeline to 42,000 events/sec (<18ms p99).",
          "Cut compute spend by 34% ($410K/yr) via consumer batching.",
        ],
        grounding: "kb",
        matchedKbHeadings: ["Candidate Overview"],
        providerName: "test-gemini",
        latencyMs: 85,
      };
      return turn;
    },
    async submitWebcamTurn() {
      webcamCalls += 1;
      return {
        turnId: "turn-cam-1",
        trigger: "webcam",
        transcript: "Two-Sum whiteboard problem",
        answerBullets: ["Use hash map for O(N) single-pass lookup."],
        grounding: "general",
        matchedKbHeadings: [],
        providerName: "test-gemini · Logitech Brio",
        latencyMs: 110,
      };
    },
    async submitTextTurn(q) {
      return {
        turnId: "turn-txt-1",
        trigger: "text",
        transcript: q,
        answerBullets: ["Concise point."],
        grounding: "general",
        matchedKbHeadings: [],
        providerName: "test-gemini",
        latencyMs: 40,
      };
    },
    async startMacMic() {
      macMicStarts += 1;
    },
    async stopMacMic() {
      macMicStops += 1;
    },
  };

  const snapshots: CadenceSessionSnapshot[] = [];
  const session = await startCadenceSession({
    resolveBridge: async () => fakeBridge,
    backend: fakeBackend,
    onSnapshot: (s) => snapshots.push(s),
  });

  assert.equal(fakeBridge.startupPayloads.length, 1);

  // 1. Press & hold R1 ring
  fakeBridge.emitEvent({
    sysEvent: new Sys_ItemEvent({
      eventType: OsEventTypeList.LONG_PRESS_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    }),
  });
  await flushAsync();
  assert.equal(fakeBridge.audioCalls.length, 1);
  assert.deepEqual(fakeBridge.audioCalls[0], {
    isOpen: true,
    source: AudioInputSource.Glasses,
  });

  // 2. Push 16 kHz PCM frame from G2 glasses
  fakeBridge.emitEvent({
    audioEvent: new AudioEvent({
      audioPcm: new Uint8Array([
        0x10, 0x00, 0x20, 0x00, 0x30, 0x00, 0x40, 0x00,
      ]),
      source: AudioInputSource.Glasses,
    }),
  });

  // 3. Release R1 ring
  fakeBridge.emitEvent({
    sysEvent: new Sys_ItemEvent({
      eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    }),
  });
  await flushAsync();

  assert.equal(fakeBridge.audioCalls.length, 2);
  assert.equal(fakeBridge.audioCalls[1]?.isOpen, false);
  assert.equal(capturedWavPayloads.length, 1);

  const wavBuffer = Buffer.from(capturedWavPayloads[0]!, "base64");
  assert.equal(wavBuffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wavBuffer.byteLength, 44 + 8);

  const afterVoice = session.getSnapshot();
  assert.equal(afterVoice.domain.phase, "ANSWER_READY");
  assert.equal(afterVoice.domain.activeTurn?.grounding, "kb");
  assert.match(afterVoice.screenText, /CADENCE \[KB\] MIC/);

  // 4. Single tap R1 ring -> triggers Logitech webcam snapshot
  fakeBridge.emitEvent({
    sysEvent: new Sys_ItemEvent({
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    }),
  });
  await flushAsync();
  assert.equal(webcamCalls, 1);
  assert.match(session.getSnapshot().screenText, /CADENCE \[GEN\] CAM/);

  // 5. Switch to Mac Mic mode and verify remote Mac Mic start/stop
  session.setAudioSourceMode("mac-mic");
  fakeBridge.emitEvent({
    sysEvent: new Sys_ItemEvent({
      eventType: OsEventTypeList.LONG_PRESS_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    }),
  });
  fakeBridge.emitEvent({
    sysEvent: new Sys_ItemEvent({
      eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT,
      eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
    }),
  });
  await flushAsync();
  assert.equal(macMicStarts, 1);
  assert.equal(macMicStops, 1);

  session.dispose();
  assert.equal(fakeBridge.unsubscribedCount, 3);
});
