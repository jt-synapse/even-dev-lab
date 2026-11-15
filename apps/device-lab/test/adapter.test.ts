import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AudioEvent,
  AudioInputSource,
  DeviceStatus,
  EventSourceType,
  OsEventTypeList,
  StartUpPageCreateResult,
  Sys_ItemEvent,
  Text_ItemEvent,
  type EvenHubEvent,
  type LaunchSource,
} from "@evenrealities/even_hub_sdk";

import {
  normalizeEvenHubEvent,
  startDiagnosticSession,
  type DiagnosticSessionSnapshot,
  type EvenBridgeTransport,
} from "../src/even/adapter.ts";

class FakeBridge implements EvenBridgeTransport {
  startupResult: StartUpPageCreateResult = StartUpPageCreateResult.success;
  startupCalls = 0;
  upgrades: string[] = [];
  shutdownModes: Array<number | undefined> = [];
  unsubscribedCount = 0;

  private eventListener: ((event: EvenHubEvent) => void) | null = null;
  private launchListener: ((source: LaunchSource) => void) | null = null;
  private statusListener: ((status: DeviceStatus) => void) | null = null;

  async createStartUpPageContainer(): Promise<StartUpPageCreateResult> {
    this.startupCalls += 1;
    return this.startupResult;
  }

  async textContainerUpgrade(container: {
    content?: string;
  }): Promise<boolean> {
    this.upgrades.push(container.content ?? "");
    return true;
  }

  async shutDownPageContainer(exitMode?: number): Promise<boolean> {
    this.shutdownModes.push(exitMode);
    return true;
  }

  onEvenHubEvent(callback: (event: EvenHubEvent) => void): () => void {
    this.eventListener = callback;
    return () => {
      this.unsubscribedCount += 1;
      this.eventListener = null;
    };
  }

  onLaunchSource(callback: (source: LaunchSource) => void): () => void {
    this.launchListener = callback;
    return () => {
      this.unsubscribedCount += 1;
      this.launchListener = null;
    };
  }

  onDeviceStatusChanged(callback: (status: DeviceStatus) => void): () => void {
    this.statusListener = callback;
    return () => {
      this.unsubscribedCount += 1;
      this.statusListener = null;
    };
  }

  emitEvent(event: EvenHubEvent): void {
    this.eventListener?.(event);
  }

  emitLaunchSource(source: LaunchSource): void {
    this.launchListener?.(source);
  }

  emitDeviceStatus(status: DeviceStatus): void {
    this.statusListener?.(status);
  }
}

test("protobuf zero-value omission on sysEvent maps to tap with unknown origin (never assumes ring)", () => {
  const normalized = normalizeEvenHubEvent(
    { sysEvent: new Sys_ItemEvent({}) },
    "2026-11-14T20:00:00.000Z",
  );
  assert.equal(normalized.command, "tap");
  assert.equal(normalized.origin, "unknown");
});

test("long press preserves explicit ring and temple eventSource values", () => {
  const ringHold = normalizeEvenHubEvent(
    {
      sysEvent: new Sys_ItemEvent({
        eventType: OsEventTypeList.LONG_PRESS_EVENT,
        eventSource: EventSourceType.TOUCH_EVENT_FROM_RING,
      }),
    },
    "2026-11-14T20:00:01.000Z",
  );
  assert.equal(ringHold.command, "long_press");
  assert.equal(ringHold.origin, "ring");

  const textScroll = normalizeEvenHubEvent(
    {
      textEvent: new Text_ItemEvent({
        containerID: 1,
        containerName: "diag-main",
        eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
      }),
    },
    "2026-11-14T20:00:02.000Z",
  );
  assert.equal(textScroll.command, "scroll_down");
  assert.equal(textScroll.origin, "unknown");
});

test("audio frames summarize byte count without logging raw PCM bytes", () => {
  const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const normalized = normalizeEvenHubEvent(
    {
      audioEvent: new AudioEvent({
        audioPcm: pcm,
        source: AudioInputSource.Glasses,
      }),
    },
    "2026-11-14T20:00:03.000Z",
  );
  assert.equal(normalized.command, "audio_frame");
  assert.match(normalized.rawSanitized, /"pcmBytes":8/);
  assert.equal(normalized.rawSanitized.includes("[1,2,3"), false);
});

test("adapter awaits startup success, upgrades text on tap, and cleans up on SYSTEM_EXIT_EVENT", async () => {
  const fake = new FakeBridge();
  const snapshots: DiagnosticSessionSnapshot[] = [];
  let readyMode: string | null = null;

  const session = await startDiagnosticSession({
    resolveBridge: async () => fake,
    nowIso: () => "2026-11-14T20:00:00.000Z",
    onSnapshot: (s) => snapshots.push(s),
    onReady: ({ mode }) => {
      readyMode = mode;
    },
  });

  assert.equal(readyMode, "bridge");
  assert.equal(fake.startupCalls, 1);
  assert.equal(session.getSnapshot().connectionStatus, "ready");

  fake.emitLaunchSource("glassesMenu");
  assert.equal(session.getSnapshot().launchSource, "glassesMenu");

  fake.emitDeviceStatus(
    DeviceStatus.fromJson({
      sn: "G2-SIM",
      connectType: "connected",
      batteryLevel: 88,
      isWearing: true,
    }),
  );
  assert.equal(session.getSnapshot().deviceStatus?.batteryLevel, 88);

  fake.emitEvent({
    sysEvent: new Sys_ItemEvent({
      eventSource: EventSourceType.TOUCH_EVENT_FROM_GLASSES_R,
    }),
  });

  // Allow serialized microtask queue to flush textContainerUpgrade.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fake.upgrades.length, 1);
  assert.match(fake.upgrades[0] ?? "", /EVEN DEV LAB \| ACTIVE/);

  fake.emitEvent({
    sysEvent: new Sys_ItemEvent({
      eventType: OsEventTypeList.SYSTEM_EXIT_EVENT,
    }),
  });
  assert.equal(fake.unsubscribedCount, 3);
  session.dispose();
});

test("startup failure reports failed status and never emits APP_READY", async () => {
  const fake = new FakeBridge();
  fake.startupResult = StartUpPageCreateResult.invalid;
  let readyCalled = false;

  const session = await startDiagnosticSession({
    resolveBridge: async () => fake,
    onSnapshot: () => {},
    onReady: () => {
      readyCalled = true;
    },
  });

  assert.equal(readyCalled, false);
  assert.equal(session.getSnapshot().connectionStatus, "failed");
  assert.match(session.getSnapshot().errorMessage ?? "", /invalid \(code 1\)/);
  assert.equal(fake.unsubscribedCount, 3);
});

test("bridge readiness timeout fails explicitly instead of hanging", async () => {
  const session = await startDiagnosticSession({
    bridgeTimeoutMs: 25,
    resolveBridge: () => new Promise(() => {}),
    onSnapshot: () => {},
  });

  assert.equal(session.getSnapshot().connectionStatus, "failed");
  assert.match(
    session.getSnapshot().errorMessage ?? "",
    /waitForEvenAppBridge timed out/,
  );
});
