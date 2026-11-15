import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AudioEvent,
  AudioInputSource,
  DeviceInfo,
  DeviceModel,
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
import { formatDeviceStatusSummary } from "../src/ui/phone-view.ts";

type UpgradeHandler = (container: { content?: string }) => Promise<boolean>;

class FakeBridge implements EvenBridgeTransport {
  startupResult: StartUpPageCreateResult = StartUpPageCreateResult.success;
  startupCalls = 0;
  upgrades: string[] = [];
  shutdownModes: Array<number | undefined> = [];
  unsubscribedCount = 0;
  deviceInfoHandler: (() => Promise<DeviceInfo | null>) | null = null;
  upgradeHandler: UpgradeHandler | null = null;

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
    if (this.upgradeHandler) {
      return this.upgradeHandler(container);
    }
    this.upgrades.push(container.content ?? "");
    return true;
  }

  async shutDownPageContainer(exitMode?: number): Promise<boolean> {
    this.shutdownModes.push(exitMode);
    return true;
  }

  async getDeviceInfo(): Promise<DeviceInfo | null> {
    return this.deviceInfoHandler ? this.deviceInfoHandler() : null;
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

test("getDeviceInfo populates cold-start hardware summary without leaking SN and preserves model on status updates", async () => {
  const fake = new FakeBridge();
  const secretSn = "SECRET-G2-SERIAL-9988";
  fake.deviceInfoHandler = async () =>
    DeviceInfo.fromJson({
      model: DeviceModel.G2,
      sn: secretSn,
      status: {
        sn: secretSn,
        connectType: "connected",
        batteryLevel: 91,
        isWearing: true,
        isCharging: false,
        isInCase: false,
      },
    });

  const session = await startDiagnosticSession({
    resolveBridge: async () => fake,
    onSnapshot: () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  const initialSnap = session.getSnapshot();
  assert.equal(initialSnap.connectionStatus, "ready");
  assert.equal(initialSnap.deviceStatus?.model, "g2");
  assert.equal(initialSnap.deviceStatus?.connectType, "connected");
  assert.equal(initialSnap.deviceStatus?.batteryLevel, 91);
  assert.equal(initialSnap.deviceStatus?.isWearing, true);
  assert.equal(initialSnap.deviceStatus?.isCharging, false);
  assert.equal(initialSnap.deviceStatus?.isInCase, false);
  assert.equal(JSON.stringify(initialSnap).includes(secretSn), false);

  fake.emitDeviceStatus(
    DeviceStatus.fromJson({
      sn: secretSn,
      connectType: "connected",
      batteryLevel: 85,
      isWearing: false,
      isCharging: true,
      isInCase: true,
    }),
  );

  const updatedSnap = session.getSnapshot();
  assert.equal(updatedSnap.deviceStatus?.model, "g2");
  assert.equal(updatedSnap.deviceStatus?.batteryLevel, 85);
  assert.equal(updatedSnap.deviceStatus?.isWearing, false);
  assert.equal(updatedSnap.deviceStatus?.isCharging, true);
  assert.equal(updatedSnap.deviceStatus?.isInCase, true);
  assert.equal(JSON.stringify(updatedSnap).includes(secretSn), false);
  session.dispose();
});

test("getDeviceInfo failure is non-fatal and never marks ready session as failed", async () => {
  const fake = new FakeBridge();
  fake.deviceInfoHandler = async () => {
    throw new Error("getGlassesInfo unsupported on host");
  };
  let readyCalls = 0;

  const session = await startDiagnosticSession({
    resolveBridge: async () => fake,
    onSnapshot: () => {},
    onReady: () => {
      readyCalls += 1;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(readyCalls, 1);
  assert.equal(session.getSnapshot().connectionStatus, "ready");
  assert.equal(session.getSnapshot().errorMessage, null);
  assert.equal(session.getSnapshot().deviceStatus, null);
  session.dispose();
});

test("late getDeviceInfo backfills model without overwriting newer status fields", async () => {
  const fake = new FakeBridge();
  const infoGate: { resolve?: (info: DeviceInfo | null) => void } = {};
  fake.deviceInfoHandler = () =>
    new Promise((resolve) => {
      infoGate.resolve = resolve;
    });

  const session = await startDiagnosticSession({
    resolveBridge: async () => fake,
    onSnapshot: () => {},
  });

  fake.emitDeviceStatus(
    DeviceStatus.fromJson({
      connectType: "disconnected",
      batteryLevel: 77,
      isWearing: false,
    }),
  );

  infoGate.resolve?.(
    DeviceInfo.fromJson({
      model: DeviceModel.G2,
      sn: "SECRET-SN",
      status: {
        connectType: "connected",
        batteryLevel: 100,
        isWearing: true,
        isCharging: true,
        isInCase: true,
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  const snap = session.getSnapshot();
  assert.equal(snap.deviceStatus?.model, "g2");
  assert.equal(snap.deviceStatus?.connectType, "disconnected");
  assert.equal(snap.deviceStatus?.batteryLevel, 77);
  assert.equal(snap.deviceStatus?.isWearing, false);
  assert.equal(snap.deviceStatus?.isCharging, false);
  assert.equal(snap.deviceStatus?.isInCase, false);

  // Partial status update omitting boolean/battery fields must also stay null
  // even if a late getDeviceInfo() had older populated fields.
  const fake2 = new FakeBridge();
  const infoGate2: { resolve?: (info: DeviceInfo | null) => void } = {};
  fake2.deviceInfoHandler = () =>
    new Promise((resolve) => {
      infoGate2.resolve = resolve;
    });
  const session2 = await startDiagnosticSession({
    resolveBridge: async () => fake2,
    onSnapshot: () => {},
  });
  fake2.emitDeviceStatus({ connectType: "disconnected" } as DeviceStatus);
  infoGate2.resolve?.(
    DeviceInfo.fromJson({
      model: DeviceModel.G2,
      status: {
        connectType: "connected",
        batteryLevel: 99,
        isWearing: true,
        isCharging: true,
        isInCase: true,
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  const snap2 = session2.getSnapshot();
  assert.equal(snap2.deviceStatus?.model, "g2");
  assert.equal(snap2.deviceStatus?.connectType, "disconnected");
  assert.equal(snap2.deviceStatus?.batteryLevel, null);
  assert.equal(snap2.deviceStatus?.isWearing, null);
  assert.equal(snap2.deviceStatus?.isCharging, null);
  assert.equal(snap2.deviceStatus?.isInCase, null);
  session2.dispose();
  session.dispose();
});

test("getDeviceInfo timeout settles non-fatally and dispose cancels cleanly", async () => {
  const fake = new FakeBridge();
  fake.deviceInfoHandler = () => new Promise(() => {});

  const session = await startDiagnosticSession({
    callTimeoutMs: 25,
    resolveBridge: async () => fake,
    onSnapshot: () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(session.getSnapshot().connectionStatus, "ready");
  assert.equal(session.getSnapshot().errorMessage, null);
  assert.equal(session.getSnapshot().deviceStatus, null);
  session.dispose();
});

test("transient textContainerUpgrade error clears on subsequent successful upgrade", async () => {
  const fake = new FakeBridge();
  let attempt = 0;
  fake.upgradeHandler = async (container) => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error("transient BLE write failure");
    }
    fake.upgrades.push(container.content ?? "");
    return true;
  };

  const session = await startDiagnosticSession({
    resolveBridge: async () => fake,
    onSnapshot: () => {},
  });

  fake.emitEvent({
    textEvent: new Text_ItemEvent({
      eventType: OsEventTypeList.CLICK_EVENT,
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(
    session.getSnapshot().errorMessage ?? "",
    /textContainerUpgrade: transient BLE write failure/,
  );

  fake.emitEvent({
    textEvent: new Text_ItemEvent({
      eventType: OsEventTypeList.CLICK_EVENT,
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(session.getSnapshot().errorMessage, null);
  assert.equal(fake.upgrades.length, 1);
  session.dispose();
});

test("formatDeviceStatusSummary formats null, zero battery, not-worn, charging, and in-case", () => {
  assert.equal(formatDeviceStatusSummary(null), "status not emitted");
  assert.equal(
    formatDeviceStatusSummary({
      model: "g2",
      connectType: "connected",
      batteryLevel: 0,
      isWearing: false,
      isCharging: true,
      isInCase: true,
    }),
    "g2 · connected · 0% · not-worn · charging · in-case",
  );
  assert.equal(
    formatDeviceStatusSummary({
      model: null,
      connectType: "disconnected",
      batteryLevel: null,
      isWearing: null,
      isCharging: null,
      isInCase: null,
    }),
    "disconnected",
  );
});
