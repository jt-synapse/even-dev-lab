import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";

import {
  analyzeGlassesFramebuffer,
  decodePngRgba,
  diffRgbaBuffers,
  hasImageVariance,
} from "./png-inspect.mjs";
import { parseQrLabArgs } from "./qr-lab.mjs";
import {
  findConsoleErrors,
  parsePortEnv,
  runSimulatorSuite,
  terminateChild,
} from "./sim-harness.mjs";
import { resolveSimLabTarget } from "./sim-lab.mjs";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    const byte = buf[i] ?? 0;
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Encode an 8-bit RGBA buffer into a valid PNG (with configurable scanline filter).
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @param {0 | 1 | 2 | 3 | 4} [filterType]
 * @returns {Buffer}
 */
function encodeRgbaPng(width, height, rgba, filterType = 0) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bitDepth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y += 1) {
    const outRow = y * (1 + rowBytes);
    raw[outRow] = filterType;
    const srcRow = y * rowBytes;
    const prevRow = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const cur = rgba[srcRow + x] ?? 0;
      const a = x >= 4 ? (rgba[srcRow + x - 4] ?? 0) : 0;
      const b = y > 0 ? (rgba[prevRow + x] ?? 0) : 0;
      const c = x >= 4 && y > 0 ? (rgba[prevRow + x - 4] ?? 0) : 0;
      let pred = 0;
      if (filterType === 1) pred = a;
      else if (filterType === 2) pred = b;
      else if (filterType === 3) pred = (a + b) >> 1;
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[outRow + 1 + x] = (cur - pred) & 0xff;
    }
  }

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Create a 576x288 glasses framebuffer filled with unlit transparent green (0,255,0,0),
 * optionally painting rectangles of lit pixels.
 * @param {Array<{ x: number, y: number, w: number, h: number, alpha?: number }>} [rects]
 * @returns {Uint8Array}
 */
function makeGlassesBuffer(rects = []) {
  const width = 576;
  const height = 288;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4 + 1] = 255; // unlit green with A=0 (simulator 0.9.5 format)
  }
  for (const rect of rects) {
    const alpha = rect.alpha ?? 255;
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const idx = (y * width + x) * 4;
        rgba[idx] = 0;
        rgba[idx + 1] = 255;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = alpha;
      }
    }
  }
  return rgba;
}

class FakeChild extends EventEmitter {
  /** @type {number | undefined} */
  pid;
  /** @type {number | null} */
  exitCode = null;
  /** @type {string | null} */
  signalCode = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  /** @type {string[]} */
  signals = [];
  /** @type {boolean} */
  ignoreSigterm;

  /**
   * @param {number | undefined} pid
   * @param {boolean} [ignoreSigterm]
   */
  constructor(pid, ignoreSigterm = false) {
    super();
    this.pid = pid;
    this.ignoreSigterm = ignoreSigterm;
  }

  /**
   * @param {NodeJS.Signals | number} [signal]
   * @returns {boolean}
   */
  kill(signal = "SIGTERM") {
    const sig = String(signal);
    this.signals.push(sig);
    if (sig === "SIGTERM" && this.ignoreSigterm) {
      return true;
    }
    this.signalCode = sig;
    void Promise.resolve().then(() => {
      this.emit("exit", null, sig);
    });
    return true;
  }
}

test("decodePngRgba decodes all PNG filter types (0..4) accurately and rejects bad headers", () => {
  const w = 8;
  const h = 6;
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = (i * 37) & 0xff;
  }

  for (const filter of /** @type {const} */ ([0, 1, 2, 3, 4])) {
    const png = encodeRgbaPng(w, h, pixels, filter);
    const decoded = decodePngRgba(png);
    assert.equal(decoded.width, w);
    assert.equal(decoded.height, h);
    assert.equal(decoded.colorType, 6);
    assert.deepEqual(decoded.rgba, pixels);
  }

  assert.throws(() => decodePngRgba(Buffer.from("not-a-png")), /Invalid PNG/);
});

test("analyzeGlassesFramebuffer preserves alpha and distinguishes unlit transparent vs alpha-stripped green", () => {
  const blankBuffer = makeGlassesBuffer();
  const blankStats = analyzeGlassesFramebuffer(
    decodePngRgba(encodeRgbaPng(576, 288, blankBuffer)),
  );
  assert.equal(blankStats.litPixels, 0);
  assert.equal(blankStats.transparentPixels, 576 * 288);

  // Simulate alpha stripping (every pixel A=255 solid green): transparentPixels becomes 0!
  const strippedBuffer = makeGlassesBuffer([
    { x: 0, y: 0, w: 576, h: 288, alpha: 255 },
  ]);
  const strippedStats = analyzeGlassesFramebuffer(
    decodePngRgba(encodeRgbaPng(576, 288, strippedBuffer)),
  );
  assert.equal(strippedStats.transparentPixels, 0);
  assert.equal(strippedStats.litPixels, 576 * 288);

  const rendered = makeGlassesBuffer([
    { x: 10, y: 10, w: 40, h: 20, alpha: 200 }, // top band
    { x: 10, y: 110, w: 40, h: 15, alpha: 200 }, // middle band
    { x: 10, y: 210, w: 40, h: 15, alpha: 200 }, // bottom band
  ]);
  const stats = analyzeGlassesFramebuffer(
    decodePngRgba(encodeRgbaPng(576, 288, rendered)),
  );
  assert.equal(stats.litPixels, 40 * 20 + 40 * 15 + 40 * 15);
  assert.equal(stats.litBandCounts.top, 800);
  assert.equal(stats.litBandCounts.middle, 600);
  assert.equal(stats.litBandCounts.bottom, 600);
  assert.deepEqual(stats.litBounds, {
    minX: 10,
    minY: 10,
    maxX: 49,
    maxY: 224,
  });
});

test("diffRgbaBuffers measures localized pixel updates accurately", () => {
  const before = decodePngRgba(
    encodeRgbaPng(
      576,
      288,
      makeGlassesBuffer([{ x: 10, y: 10, w: 40, h: 30 }]),
    ),
  );
  const after = decodePngRgba(
    encodeRgbaPng(
      576,
      288,
      makeGlassesBuffer([
        { x: 10, y: 10, w: 40, h: 30 },
        { x: 200, y: 150, w: 20, h: 10 },
      ]),
    ),
  );
  const diff = diffRgbaBuffers(before, after);
  assert.equal(diff.changedPixels, 200);
  assert.equal(diff.alphaChangedPixels, 200);
  assert.equal(diff.changedBandCounts.middle, 200);
  assert.equal(diff.changedBandCounts.top, 0);
  assert.deepEqual(diff.changedBounds, {
    minX: 200,
    minY: 150,
    maxX: 219,
    maxY: 159,
  });
});

test("findConsoleErrors detects runtime errors and failed bridge states", () => {
  const errors = findConsoleErrors([
    { id: 1, level: "info", message: "[device-lab] APP_READY mode=bridge" },
    { id: 2, level: "warn", message: "minor warning" },
    { id: 3, level: "log", message: "[uncaught] ReferenceError: x" },
    {
      id: 4,
      level: "info",
      message:
        "[device-lab] STATE phase=READY taps=0 focus=0 status=failed seq=0 last=none origin=none",
    },
    { id: 5, level: "error", message: "boom" },
    {
      id: 6,
      level: "warn",
      message: "[device-lab] BRIDGE_OP_ERROR textContainerUpgrade: timeout",
    },
  ]);
  assert.deepEqual(
    errors.map((e) => e.id),
    [3, 4, 5, 6],
  );
});

test("terminateChild sends SIGTERM first and escalates to SIGKILL when unresponsive", async () => {
  const polite = new FakeChild(1001, false);
  const res1 = await terminateChild(polite, "polite", 50);
  assert.deepEqual(polite.signals, ["SIGTERM"]);
  assert.equal(res1.forcedKill, false);

  const stubborn = new FakeChild(1002, true);
  const res2 = await terminateChild(stubborn, "stubborn", 20);
  assert.deepEqual(stubborn.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(res2.forcedKill, true);
});

/**
 * @param {string | Buffer} body
 * @param {number} [status]
 * @returns {import("./sim-harness.mjs").HttpResponseLike}
 */
function makeHttpResponse(body, status = 200) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => buf.toString("utf8"),
    json: async () => JSON.parse(buf.toString("utf8")),
    arrayBuffer: async () => new Uint8Array(buf).buffer,
  };
}

/**
 * Create a lightweight fake simulator + dev server environment for suite tests.
 * @param {{
 *   failMode?:
 *     | "none"
 *     | "uncaught_on_click"
 *     | "alpha_stripped"
 *     | "unchanged_after_click"
 *     | "early_vite_exit"
 *     | "sim_spawn_error"
 *     | "trailing_error_after_click2",
 * }} [cfg]
 */
function makeFakeHarnessDeps(cfg = {}) {
  const failMode = cfg.failMode ?? "none";
  /** @type {FakeChild[]} */
  const children = [];

  const frame0 = encodeRgbaPng(
    576,
    288,
    makeGlassesBuffer(
      failMode === "alpha_stripped"
        ? [{ x: 0, y: 0, w: 576, h: 288, alpha: 255 }]
        : [
            { x: 16, y: 16, w: 120, h: 16 },
            { x: 16, y: 110, w: 120, h: 16 },
            { x: 16, y: 200, w: 120, h: 16 },
          ],
    ),
  );
  const webviewPixels = new Uint8Array(240 * 320 * 4);
  for (let i = 0; i < 240 * 320; i += 1) {
    webviewPixels[i * 4] = i % 2 === 0 ? 17 : 254;
    webviewPixels[i * 4 + 3] = 255;
  }
  const webviewPng = encodeRgbaPng(240, 320, webviewPixels);

  let currentFrame = frame0;
  let stepCounter = 0;
  const consoleEntries = [
    { id: 1, level: "info", message: "[device-lab] APP_READY mode=bridge" },
    {
      id: 2,
      level: "info",
      message:
        "[device-lab] STATE phase=READY taps=0 focus=0 status=ready seq=0 last=none origin=none",
    },
  ];
  let nextConsoleId = 3;

  /** @type {import("./sim-harness.mjs").SpawnLike} */
  const spawnFn = (cmd) => {
    const isVite = cmd.endsWith("vite");
    const simErr = !isVite && failMode === "sim_spawn_error";
    const child = new FakeChild(simErr ? undefined : 2000 + children.length);
    children.push(child);
    if (isVite) {
      void Promise.resolve().then(() => {
        child.stdout.emit("data", "VITE ready API_KEY=supersecretvalue\n");
        if (failMode === "early_vite_exit") {
          child.exitCode = 1;
          child.emit("exit", 1, null);
        }
      });
    } else if (simErr) {
      void Promise.resolve().then(() => {
        child.emit("error", new Error("spawn evenhub-simulator ENOENT"));
      });
    }
    return child;
  };

  /** @type {import("./sim-harness.mjs").FetchLike} */
  const fetchFn = async (url, init = {}) => {
    const urlStr = String(url);
    if (urlStr.endsWith(":5181") || urlStr.endsWith(":5181/")) {
      if (failMode === "early_vite_exit") {
        throw new Error("ECONNREFUSED");
      }
      return makeHttpResponse("<html></html>", 200);
    }
    if (urlStr.endsWith("/api/ping")) {
      return makeHttpResponse("pong", 200);
    }
    if (urlStr.includes("/api/console")) {
      const parsed = new URL(urlStr);
      const sinceId = Number(parsed.searchParams.get("since_id") ?? "0");
      return makeHttpResponse(
        JSON.stringify({
          entries: consoleEntries.filter((e) => e.id > sinceId),
          total: consoleEntries.length,
        }),
        200,
      );
    }
    if (urlStr.endsWith("/api/screenshot/glasses")) {
      return makeHttpResponse(currentFrame, 200);
    }
    if (urlStr.endsWith("/api/screenshot/webview")) {
      if (failMode === "trailing_error_after_click2" && stepCounter === 6) {
        consoleEntries.push({
          id: nextConsoleId++,
          level: "warn",
          message:
            "[device-lab] BRIDGE_OP_ERROR textContainerUpgrade: trailing BLE failure",
        });
      }
      return makeHttpResponse(webviewPng, 200);
    }
    if (urlStr.endsWith("/api/input") && init.method === "POST") {
      const body = /** @type {{ action?: string }} */ (
        JSON.parse(String(init.body ?? "{}"))
      );
      stepCounter += 1;
      if (failMode === "uncaught_on_click" && body.action === "click") {
        consoleEntries.push({
          id: nextConsoleId++,
          level: "error",
          message: "[uncaught] simulated click crash TOKEN=secret123",
        });
        return makeHttpResponse("ok", 200);
      }
      const nextMsgByStep = [
        "[device-lab] STATE phase=ACTIVE taps=1 focus=0 status=ready seq=1 last=tap origin=glasses_right",
        "[device-lab] STATE phase=ACTIVE taps=1 focus=1 status=ready seq=2 last=scroll_down origin=unknown",
        "[device-lab] STATE phase=ACTIVE taps=1 focus=0 status=ready seq=3 last=scroll_up origin=unknown",
        "[device-lab] STATE phase=ACTIVE taps=1 focus=0 status=ready seq=4 last=long_press origin=unknown",
        "[device-lab] STATE phase=ACTIVE taps=1 focus=0 status=ready seq=5 last=long_press_release origin=unknown",
        "[device-lab] STATE phase=READY taps=2 focus=0 status=ready seq=6 last=tap origin=glasses_right",
      ];
      consoleEntries.push({
        id: nextConsoleId++,
        level: "info",
        message: nextMsgByStep[stepCounter - 1] ?? "",
      });
      if (failMode !== "unchanged_after_click") {
        currentFrame = encodeRgbaPng(
          576,
          288,
          makeGlassesBuffer([
            { x: 16 + stepCounter * 12, y: 16, w: 120, h: 16 },
            { x: 16, y: 110 + stepCounter * 4, w: 120, h: 16 },
            { x: 16, y: 200, w: 120, h: 16 },
          ]),
        );
      }
      return makeHttpResponse("ok", 200);
    }
    return makeHttpResponse("not found", 404);
  };

  return { children, spawnFn, fetchFn };
}

test("runSimulatorSuite completes full sequence, verifies artifacts, and cleans up children", async () => {
  const dir = await mkdtemp(join(tmpdir(), "even-sim-pass-"));
  try {
    const deps = makeFakeHarnessDeps({ failMode: "none" });
    const summary = await runSimulatorSuite({
      artifactDir: dir,
      devPort: 5181,
      autoPort: 9881,
      checkPortFree: async () => true,
      spawnFn: deps.spawnFn,
      fetchFn: deps.fetchFn,
      sleep: async () => {},
      timeouts: {
        devServerMs: 500,
        pingMs: 500,
        consoleMs: 500,
        screenshotMs: 500,
        graceKillMs: 50,
        requestMs: 500,
      },
    });

    assert.equal(summary.status, "passed");
    assert.equal(summary.failedStep, null);
    assert.equal(summary.cleanup.length, 2);
    assert.ok(deps.children.every((c) => c.signals.includes("SIGTERM")));
    assert.ok(existsSync(join(dir, "summary.json")));
    assert.ok(existsSync(join(dir, "console.json")));
    assert.ok(existsSync(join(dir, "process.log")));
    assert.ok(existsSync(join(dir, "glasses-initial.png")));
    assert.ok(existsSync(join(dir, "glasses-after-click.png")));
    assert.ok(existsSync(join(dir, "glasses-after-click-2.png")));

    const processLog = await readFile(join(dir, "process.log"), "utf8");
    assert.equal(processLog.includes("supersecretvalue"), false);
    assert.match(processLog, /API_KEY=\[redacted\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSimulatorSuite captures failure evidence, redacts secrets, and cleans up on console error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "even-sim-err-"));
  try {
    const deps = makeFakeHarnessDeps({ failMode: "uncaught_on_click" });
    const summary = await runSimulatorSuite({
      artifactDir: dir,
      devPort: 5181,
      autoPort: 9881,
      checkPortFree: async () => true,
      spawnFn: deps.spawnFn,
      fetchFn: deps.fetchFn,
      sleep: async () => {},
      timeouts: {
        devServerMs: 500,
        pingMs: 500,
        consoleMs: 500,
        screenshotMs: 500,
        graceKillMs: 50,
        requestMs: 500,
      },
    });

    assert.equal(summary.status, "failed");
    assert.equal(summary.failedStep, "input_click_1");
    assert.equal(summary.error?.includes("secret123"), false);
    assert.match(summary.error ?? "", /\[uncaught\]/);
    assert.ok(existsSync(join(dir, "glasses-on-failure.png")));
    assert.ok(existsSync(join(dir, "webview-on-failure.png")));
    assert.ok(deps.children.every((c) => c.signals.includes("SIGTERM")));

    const savedConsole = await readFile(join(dir, "console.json"), "utf8");
    assert.equal(savedConsole.includes("secret123"), false);
    assert.match(savedConsole, /TOKEN=\[redacted\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSimulatorSuite fails on alpha-stripped green canvas, unchanged framebuffer, busy port, and early Vite exit", async () => {
  // 1. Busy port refuses to kill external process
  const busyDir = await mkdtemp(join(tmpdir(), "even-sim-busy-"));
  try {
    const busySummary = await runSimulatorSuite({
      artifactDir: busyDir,
      devPort: 5181,
      autoPort: 9881,
      checkPortFree: async () => false,
    });
    assert.equal(busySummary.status, "failed");
    assert.equal(busySummary.failedStep, "allocate_ports");
    assert.match(busySummary.error ?? "", /refusing to kill/);
  } finally {
    await rm(busyDir, { recursive: true, force: true });
  }

  // 2. Alpha-stripped framebuffer fails initial render assertion
  const alphaDir = await mkdtemp(join(tmpdir(), "even-sim-alpha-"));
  try {
    const deps = makeFakeHarnessDeps({ failMode: "alpha_stripped" });
    const alphaSummary = await runSimulatorSuite({
      artifactDir: alphaDir,
      devPort: 5181,
      autoPort: 9881,
      checkPortFree: async () => true,
      spawnFn: deps.spawnFn,
      fetchFn: deps.fetchFn,
      sleep: async () => {},
      timeouts: {
        devServerMs: 200,
        pingMs: 200,
        consoleMs: 200,
        screenshotMs: 60,
        graceKillMs: 20,
        requestMs: 200,
      },
    });
    assert.equal(alphaSummary.status, "failed");
    assert.equal(alphaSummary.failedStep, "app_ready_and_initial_render");
    assert.ok(deps.children.every((c) => c.signals.includes("SIGTERM")));
  } finally {
    await rm(alphaDir, { recursive: true, force: true });
  }

  // 3. Unchanged framebuffer after click fails diff check
  const diffDir = await mkdtemp(join(tmpdir(), "even-sim-diff-"));
  try {
    const deps = makeFakeHarnessDeps({ failMode: "unchanged_after_click" });
    const diffSummary = await runSimulatorSuite({
      artifactDir: diffDir,
      devPort: 5181,
      autoPort: 9881,
      checkPortFree: async () => true,
      spawnFn: deps.spawnFn,
      fetchFn: deps.fetchFn,
      sleep: async () => {},
      timeouts: {
        devServerMs: 200,
        pingMs: 200,
        consoleMs: 200,
        screenshotMs: 60,
        graceKillMs: 20,
        requestMs: 200,
      },
    });
    assert.equal(diffSummary.status, "failed");
    assert.equal(diffSummary.failedStep, "input_click_1");
    assert.ok(deps.children.every((c) => c.signals.includes("SIGTERM")));
  } finally {
    await rm(diffDir, { recursive: true, force: true });
  }

  // 4. Early Vite exit fails immediately
  const viteDir = await mkdtemp(join(tmpdir(), "even-sim-vite-"));
  try {
    const deps = makeFakeHarnessDeps({ failMode: "early_vite_exit" });
    const viteSummary = await runSimulatorSuite({
      artifactDir: viteDir,
      devPort: 5181,
      autoPort: 9881,
      checkPortFree: async () => true,
      spawnFn: deps.spawnFn,
      fetchFn: deps.fetchFn,
      sleep: async () => {},
      timeouts: {
        devServerMs: 500,
        pingMs: 500,
        consoleMs: 500,
        screenshotMs: 200,
        graceKillMs: 20,
        requestMs: 200,
      },
    });
    assert.equal(viteSummary.status, "failed");
    assert.equal(viteSummary.failedStep, "boot_dev_server");
    assert.match(
      viteSummary.error ?? "",
      /Vite dev server exited unexpectedly/,
    );
  } finally {
    await rm(viteDir, { recursive: true, force: true });
  }
});

test("hasImageVariance detects uniform vs varied screenshots", () => {
  const flat = new Uint8Array(40 * 40 * 4).fill(128);
  assert.equal(
    hasImageVariance(decodePngRgba(encodeRgbaPng(40, 40, flat))),
    false,
  );

  const varied = new Uint8Array(40 * 40 * 4).fill(128);
  varied[40 * 20 * 4] = 10;
  assert.equal(
    hasImageVariance(decodePngRgba(encodeRgbaPng(40, 40, varied))),
    true,
  );
});

test("runSimulatorSuite handles simulator spawn error and trailing console errors", async () => {
  const spawnDir = await mkdtemp(join(tmpdir(), "even-sim-spawn-"));
  try {
    const deps = makeFakeHarnessDeps({ failMode: "sim_spawn_error" });
    const spawnSummary = await runSimulatorSuite({
      artifactDir: spawnDir,
      devPort: 5181,
      autoPort: 9881,
      checkPortFree: async () => true,
      spawnFn: deps.spawnFn,
      fetchFn: deps.fetchFn,
      sleep: async () => {},
      timeouts: {
        devServerMs: 500,
        pingMs: 500,
        consoleMs: 500,
        screenshotMs: 200,
        graceKillMs: 20,
        requestMs: 200,
      },
    });
    assert.equal(spawnSummary.status, "failed");
    assert.equal(spawnSummary.failedStep, "boot_simulator");
    assert.match(spawnSummary.error ?? "", /spawn error: spawn .*ENOENT/);
    assert.equal(deps.children.length, 2);
    assert.ok(deps.children[0]?.signals.includes("SIGTERM"));
    const spawnProcLog = await readFile(join(spawnDir, "process.log"), "utf8");
    assert.match(spawnProcLog, /\[sim:err\] evenhub-simulator spawn error/);
  } finally {
    await rm(spawnDir, { recursive: true, force: true });
  }

  const trailDir = await mkdtemp(join(tmpdir(), "even-sim-trail-"));
  try {
    const deps = makeFakeHarnessDeps({
      failMode: "trailing_error_after_click2",
    });
    const trailSummary = await runSimulatorSuite({
      artifactDir: trailDir,
      devPort: 5181,
      autoPort: 9881,
      checkPortFree: async () => true,
      spawnFn: deps.spawnFn,
      fetchFn: deps.fetchFn,
      sleep: async () => {},
      timeouts: {
        devServerMs: 500,
        pingMs: 500,
        consoleMs: 500,
        screenshotMs: 200,
        graceKillMs: 20,
        requestMs: 200,
      },
    });
    assert.equal(trailSummary.status, "failed");
    assert.equal(trailSummary.failedStep, "drain_final_console");
    assert.match(trailSummary.error ?? "", /trailing BLE failure/);
  } finally {
    await rm(trailDir, { recursive: true, force: true });
  }
});

test("CLI port/host/URL helpers validate inputs and normalize loopback", () => {
  assert.equal(parsePortEnv("DEV_PORT", undefined, 5173), 5173);
  assert.equal(parsePortEnv("DEV_PORT", "  ", 5173), 5173);
  assert.equal(parsePortEnv("DEV_PORT", " 4173 ", 5173), 4173);
  assert.throws(() => parsePortEnv("DEV_PORT", "abc", 5173), /1\.\.65535/);
  assert.throws(() => parsePortEnv("DEV_PORT", "0", 5173), /1\.\.65535/);
  assert.throws(() => parsePortEnv("DEV_PORT", "70000", 5173), /1\.\.65535/);

  assert.deepEqual(
    resolveSimLabTarget("0.0.0.0", "5179", ["--", "--automation-port", "9898"]),
    {
      host: "0.0.0.0",
      port: 5179,
      targetUrl: "http://127.0.0.1:5179",
      extraSimArgs: ["--automation-port", "9898"],
    },
  );
  assert.deepEqual(resolveSimLabTarget("::", undefined, []), {
    host: "::",
    port: 5173,
    targetUrl: "http://[::1]:5173",
    extraSimArgs: [],
  });
  assert.throws(() => resolveSimLabTarget("127.0.0.1", "bad", []), /DEV_PORT/);

  assert.deepEqual(parseQrLabArgs(["--url=http://192.168.1.42:5173"]), {
    ok: true,
    url: "http://192.168.1.42:5173/",
    hostname: "192.168.1.42",
    isLoopback: false,
  });
  assert.deepEqual(parseQrLabArgs(["--", "--url", "http://127.0.0.1:5173"]), {
    ok: true,
    url: "http://127.0.0.1:5173/",
    hostname: "127.0.0.1",
    isLoopback: true,
  });
  assert.equal(parseQrLabArgs(["--url", "--help"]).ok, false);
  assert.equal(parseQrLabArgs(["--url="]).ok, false);
  assert.equal(parseQrLabArgs(["ftp://192.168.1.42:5173"]).ok, false);
});
