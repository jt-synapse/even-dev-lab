// Repeatable simulator harness orchestration and assertions (M3).
// Bounded timeouts, explicit port selection, guaranteed child cleanup, and evidence retention.
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { redactOutput } from "./doctor.mjs";
import {
  analyzeGlassesFramebuffer,
  decodePngRgba,
  diffRgbaBuffers,
  hasImageVariance,
} from "./png-inspect.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {{
 *   id: number,
 *   level: string,
 *   message: string,
 *   ts?: string,
 * }} ConsoleEntry
 */

/**
 * @typedef {{
 *   name: string,
 *   pid: number | null,
 *   exitCode: number | null,
 *   signalCode: string | null,
 *   forcedKill: boolean,
 * }} ProcessExitRecord
 */

/**
 * @typedef {{
 *   step: string,
 *   action?: string,
 *   status: "passed" | "failed",
 *   detail: string,
 *   metrics?: Record<string, unknown>,
 * }} StepResult
 */

/**
 * @typedef {{
 *   status: "passed" | "failed",
 *   startedAt: string,
 *   finishedAt: string,
 *   durationMs: number,
 *   devUrl: string,
 *   automationUrl: string,
 *   artifactDir: string,
 *   failedStep: string | null,
 *   error: string | null,
 *   steps: StepResult[],
 *   cleanup: ProcessExitRecord[],
 * }} SuiteSummary
 */

/**
 * @typedef {{
 *   pid?: number,
 *   exitCode: number | null,
 *   signalCode: string | null,
 *   stdout: import("node:events").EventEmitter | null,
 *   stderr: import("node:events").EventEmitter | null,
 *   kill(signal?: NodeJS.Signals | number): boolean,
 *   on(event: string, listener: (...args: unknown[]) => void): unknown,
 *   once(event: string, listener: (...args: unknown[]) => void): unknown,
 *   removeListener?(event: string, listener: (...args: unknown[]) => void): unknown,
 * }} ManagedChild
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   status: number,
 *   text(): Promise<string>,
 *   json(): Promise<unknown>,
 *   arrayBuffer(): Promise<ArrayBuffer>,
 * }} HttpResponseLike
 */

/**
 * @typedef {(url: string, init?: {
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string,
 *   signal?: AbortSignal,
 * }) => Promise<HttpResponseLike>} FetchLike
 */

/**
 * @typedef {(
 *   command: string,
 *   args: readonly string[],
 *   options: {
 *     cwd?: string,
 *     stdio?: ("ignore" | "pipe" | "inherit")[],
 *     shell?: boolean,
 *     detached?: boolean,
 *   },
 * ) => ManagedChild} SpawnLike
 */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse and validate an optional TCP port from a string/env value.
 * @param {string} name
 * @param {string | undefined} raw
 * @param {number | undefined} [fallback]
 * @returns {number | undefined}
 */
export function parsePortEnv(name, raw, fallback = undefined) {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const trimmed = raw.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be 1..65535 (got ${JSON.stringify(raw)})`);
  }
  return parsed;
}

/**
 * Allocate an unused loopback port without disturbing any existing process.
 * @returns {Promise<number>}
 */
export function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() =>
          reject(new Error("Failed to allocate loopback port")),
        );
        return;
      }
      const { port } = addr;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

/**
 * Probe whether a specific loopback port is free before launching a child on it.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isLoopbackPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Return any simulator console entries indicating uncaught runtime or bridge errors.
 * @param {readonly ConsoleEntry[]} entries
 * @returns {ConsoleEntry[]}
 */
export function findConsoleErrors(entries) {
  return entries.filter((entry) => {
    if (entry.level === "error") return true;
    const msg = entry.message;
    if (
      msg.startsWith("[uncaught]") ||
      msg.startsWith("[unhandledrejection]") ||
      msg.startsWith("[fetch]") ||
      msg.includes("[device-lab] BRIDGE_OP_ERROR")
    ) {
      return true;
    }
    if (/\[device-lab\]\s+STATE\b.*\bstatus=(?:failed|error)\b/.test(msg)) {
      return true;
    }
    return false;
  });
}

/**
 * Terminate a child process (and its POSIX process group when spawned detached)
 * with SIGTERM, falling back to SIGKILL after graceMs.
 * @param {ManagedChild | null} child
 * @param {string} name
 * @param {number} graceMs
 * @param {boolean} killProcessGroup
 * @returns {Promise<ProcessExitRecord>}
 */
export async function terminateChild(
  child,
  name,
  graceMs = 2000,
  killProcessGroup = false,
) {
  if (!child) {
    return {
      name,
      pid: null,
      exitCode: null,
      signalCode: null,
      forcedKill: false,
    };
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      name,
      pid: child.pid ?? null,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      forcedKill: false,
    };
  }

  /** @param {NodeJS.Signals} signal */
  const sendSignal = (signal) => {
    if (
      killProcessGroup &&
      process.platform !== "win32" &&
      typeof child.pid === "number" &&
      child.pid > 0
    ) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall back to direct child.kill below if process group already exited.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // Child may have exited concurrently.
    }
  };

  /** @param {number} timeoutMs */
  const waitExit = (timeoutMs) =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(true);
        return;
      }
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.removeListener?.("exit", onExit);
        resolve(false);
      }, timeoutMs);
      child.once("exit", onExit);
    });

  sendSignal("SIGTERM");

  let forcedKill = false;
  const exitedGracefully = await waitExit(graceMs);
  if (
    !exitedGracefully &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    forcedKill = true;
    sendSignal("SIGKILL");
    await waitExit(1000);
  }

  return {
    name,
    pid: child.pid ?? null,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    forcedKill,
  };
}

/**
 * @param {string[]} buffer
 * @param {string} prefix
 * @param {string} chunk
 */
function appendLogLines(buffer, prefix, chunk) {
  const lines = redactOutput(chunk).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    buffer.push(`[${prefix}] ${trimmed}`);
    if (buffer.length > 600) {
      buffer.shift();
    }
  }
}

/**
 * Execute the full repeatable simulator test suite against apps/device-lab.
 * @param {{
 *   rootDir?: string,
 *   artifactDir?: string,
 *   devPort?: number,
 *   autoPort?: number,
 *   spawnFn?: SpawnLike,
 *   fetchFn?: FetchLike,
 *   allocatePort?: () => Promise<number>,
 *   checkPortFree?: (port: number) => Promise<boolean>,
 *   sleep?: (ms: number) => Promise<void>,
 *   nowIso?: () => string,
 *   timeouts?: {
 *     devServerMs?: number,
 *     pingMs?: number,
 *     consoleMs?: number,
 *     screenshotMs?: number,
 *     graceKillMs?: number,
 *     requestMs?: number,
 *   },
 * }} [options]
 * @returns {Promise<SuiteSummary>}
 */
export async function runSimulatorSuite(options = {}) {
  const rootDir = options.rootDir ?? DEFAULT_ROOT;
  const artifactDir =
    options.artifactDir ?? join(rootDir, "artifacts", "sim", "latest");
  const usingRealSpawn = !options.spawnFn;
  /** @type {SpawnLike} */
  const spawnFn =
    options.spawnFn ??
    ((command, args, spawnOpts) =>
      /** @type {ManagedChild} */ (spawn(command, [...args], spawnOpts)));
  const detached = usingRealSpawn && process.platform !== "win32";
  /** @type {FetchLike} */
  const fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  const allocatePort = options.allocatePort ?? allocateLoopbackPort;
  const checkPortFree = options.checkPortFree ?? isLoopbackPortFree;
  const sleep = options.sleep ?? defaultSleep;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());

  const timeouts = {
    devServerMs: options.timeouts?.devServerMs ?? 15_000,
    pingMs: options.timeouts?.pingMs ?? 20_000,
    consoleMs: options.timeouts?.consoleMs ?? 15_000,
    screenshotMs: options.timeouts?.screenshotMs ?? 4_000,
    graceKillMs: options.timeouts?.graceKillMs ?? 2_000,
    requestMs: options.timeouts?.requestMs ?? 3_000,
  };

  const startedAt = nowIso();
  const startMs = Date.now();
  const steps = /** @type {StepResult[]} */ ([]);
  const processLogs = /** @type {string[]} */ ([]);
  const capturedConsole = /** @type {ConsoleEntry[]} */ ([]);
  const seenConsoleIds = new Set();

  let devPort = options.devPort ?? 0;
  let autoPort = options.autoPort ?? 0;
  let devUrl = "";
  let automationUrl = "";
  let currentStep = "init";
  let failedStep = /** @type {string | null} */ (null);
  let errorMsg = /** @type {string | null} */ (null);

  /** @type {ManagedChild | null} */
  let viteChild = null;
  /** @type {ManagedChild | null} */
  let simChild = null;
  let viteSpawnFailed = false;
  let simSpawnFailed = false;
  let shuttingDown = false;
  let earlyChildError = /** @type {Error | null} */ (null);

  const onSigInt = () => {
    shuttingDown = true;
    earlyChildError = new Error("Interrupted by SIGINT");
  };
  const onSigTerm = () => {
    shuttingDown = true;
    earlyChildError = new Error("Interrupted by SIGTERM");
  };
  process.on("SIGINT", onSigInt);
  process.on("SIGTERM", onSigTerm);

  /**
   * @param {string} url
   * @param {{
   *   method?: string,
   *   headers?: Record<string, string>,
   *   body?: string,
   * }} [init]
   */
  const httpFetch = async (url, init = {}) => {
    /** @type {Record<string, string>} */
    const headers = {
      connection: "close",
      ...(init.headers ?? {}),
    };
    return fetchFn(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeouts.requestMs),
    });
  };

  /**
   * @param {string} path
   * @returns {Promise<Buffer>}
   */
  const fetchBytes = async (path) => {
    const res = await httpFetch(`${automationUrl}${path}`);
    if (!res.ok) {
      throw new Error(`GET ${path} returned HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  };

  let consoleCursor = 0;

  /**
   * Poll `/api/console?since_id=...` once, record new entries, and fail on errors.
   * @param {string} label
   * @returns {Promise<ConsoleEntry[]>}
   */
  const drainConsoleOnce = async (label) => {
    if (earlyChildError) throw earlyChildError;
    const res = await httpFetch(
      `${automationUrl}/api/console?since_id=${consoleCursor}`,
    );
    if (!res.ok) {
      throw new Error(`GET /api/console returned HTTP ${res.status}`);
    }
    const payload = /** @type {{ entries?: ConsoleEntry[] }} */ (
      await res.json()
    );
    const rawBatch = Array.isArray(payload.entries) ? payload.entries : [];
    /** @type {ConsoleEntry[]} */
    const newBatch = [];
    for (const item of rawBatch) {
      if (typeof item?.id !== "number") continue;
      if (item.id > consoleCursor) {
        consoleCursor = item.id;
      }
      if (seenConsoleIds.has(item.id)) continue;
      seenConsoleIds.add(item.id);
      const sanitized = {
        ...item,
        message: redactOutput(String(item.message ?? "")),
      };
      capturedConsole.push(sanitized);
      newBatch.push(sanitized);
    }

    const errors = findConsoleErrors(newBatch);
    if (errors.length > 0) {
      throw new Error(
        `Console error during "${label}": ${errors.map((e) => e.message).join(" | ")}`,
      );
    }
    return newBatch;
  };

  /**
   * Poll `/api/console?since_id=...` until `predicate` matches or timeout expires.
   * @param {string} label
   * @param {(all: readonly ConsoleEntry[], batch: readonly ConsoleEntry[]) => boolean} predicate
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  const pollConsoleUntil = async (label, predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const newBatch = await drainConsoleOnce(label);
      if (predicate(capturedConsole, newBatch)) {
        return;
      }
      await sleep(100);
    }

    const tail = capturedConsole
      .slice(-6)
      .map((e) => `[#${e.id} ${e.level}] ${e.message}`)
      .join("\n  ");
    throw new Error(
      `Timed out waiting for console condition "${label}" (${timeoutMs}ms). Recent console:\n  ${tail || "(empty)"}`,
    );
  };

  /**
   * @param {string} action
   */
  const sendInput = async (action) => {
    const res = await httpFetch(`${automationUrl}/api/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `POST /api/input (${action}) failed with HTTP ${res.status}: ${redactOutput(body)}`,
      );
    }
  };

  /**
   * Wait for the glasses framebuffer to pass an assertion (handles async bridge render flush).
   * @param {string} label
   * @param {(buf: Buffer, decoded: ReturnType<typeof decodePngRgba>) => boolean} checkFn
   * @param {number} timeoutMs
   * @returns {Promise<{ bytes: Buffer, decoded: ReturnType<typeof decodePngRgba> }>}
   */
  const waitGlassesFrame = async (label, checkFn, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "no frames checked";
    while (Date.now() < deadline) {
      if (earlyChildError) throw earlyChildError;
      try {
        const bytes = await fetchBytes("/api/screenshot/glasses");
        const decoded = decodePngRgba(bytes);
        if (checkFn(bytes, decoded)) {
          return { bytes, decoded };
        }
        lastError = `frame predicate returned false`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      await sleep(100);
    }
    throw new Error(
      `Timed out waiting for glasses framebuffer "${label}" (${timeoutMs}ms): ${lastError}`,
    );
  };

  /**
   * @param {string} fileName
   * @param {Buffer} data
   */
  const writeArtifact = async (fileName, data) => {
    await writeFile(join(artifactDir, fileName), data);
  };

  /** @type {SuiteSummary} */
  let summary;
  try {
    await rm(artifactDir, { recursive: true, force: true });
    await mkdir(artifactDir, { recursive: true });

    currentStep = "allocate_ports";
    if (devPort > 0) {
      if (!(await checkPortFree(devPort))) {
        throw new Error(
          `Dev server port ${devPort} is already in use (refusing to kill external processes)`,
        );
      }
    } else {
      devPort = await allocatePort();
    }
    if (autoPort > 0) {
      if (autoPort === devPort) {
        throw new Error(
          `Dev port and automation port cannot both be ${autoPort}`,
        );
      }
      if (!(await checkPortFree(autoPort))) {
        throw new Error(
          `Automation port ${autoPort} is already in use (refusing to kill external processes)`,
        );
      }
    } else {
      autoPort = await allocatePort();
      let attempts = 0;
      while (autoPort === devPort) {
        attempts += 1;
        if (attempts > 5) {
          throw new Error(
            `Unable to allocate automation port distinct from dev port ${devPort}`,
          );
        }
        autoPort = await allocatePort();
      }
    }
    devUrl = `http://127.0.0.1:${devPort}`;
    automationUrl = `http://127.0.0.1:${autoPort}`;
    steps.push({
      step: currentStep,
      status: "passed",
      detail: `Allocated devPort=${devPort}, autoPort=${autoPort}`,
    });

    currentStep = "boot_dev_server";
    const viteBin = join(rootDir, "node_modules", ".bin", "vite");
    const appDir = join(rootDir, "apps", "device-lab");
    viteChild = /** @type {ManagedChild} */ (
      spawnFn(
        viteBin,
        ["--host", "127.0.0.1", "--port", String(devPort), "--strictPort"],
        {
          cwd: appDir,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          detached,
        },
      )
    );
    viteChild.stdout?.on("data", (chunk) =>
      appendLogLines(processLogs, "vite:out", String(chunk)),
    );
    viteChild.stderr?.on("data", (chunk) =>
      appendLogLines(processLogs, "vite:err", String(chunk)),
    );
    viteChild.on("error", (err) => {
      viteSpawnFailed = true;
      const msg = `Vite dev server spawn error: ${err instanceof Error ? err.message : String(err)}`;
      appendLogLines(processLogs, "vite:err", msg);
      if (!shuttingDown && !earlyChildError) {
        earlyChildError = new Error(msg);
      }
    });
    viteChild.on("exit", (code, signal) => {
      if (!shuttingDown && !earlyChildError) {
        earlyChildError = new Error(
          `Vite dev server exited unexpectedly (code=${String(code ?? "null")}, signal=${String(signal ?? "null")})`,
        );
      }
    });

    const devDeadline = Date.now() + timeouts.devServerMs;
    let devReady = false;
    while (Date.now() < devDeadline) {
      if (earlyChildError) throw earlyChildError;
      try {
        const res = await httpFetch(devUrl);
        if (earlyChildError) throw earlyChildError;
        if (res.ok) {
          devReady = true;
          break;
        }
      } catch (err) {
        if (earlyChildError) throw earlyChildError;
        void err;
      }
      await sleep(150);
    }
    if (!devReady) {
      throw new Error(
        `Vite dev server at ${devUrl} did not become ready within ${timeouts.devServerMs}ms`,
      );
    }
    steps.push({
      step: currentStep,
      status: "passed",
      detail: `Vite dev server ready at ${devUrl}`,
    });

    currentStep = "boot_simulator";
    const simBin = join(rootDir, "node_modules", ".bin", "evenhub-simulator");
    simChild = /** @type {ManagedChild} */ (
      spawnFn(
        simBin,
        ["--no-glow", "--automation-port", String(autoPort), devUrl],
        {
          cwd: rootDir,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          detached,
        },
      )
    );
    simChild.stdout?.on("data", (chunk) =>
      appendLogLines(processLogs, "sim:out", String(chunk)),
    );
    simChild.stderr?.on("data", (chunk) =>
      appendLogLines(processLogs, "sim:err", String(chunk)),
    );
    simChild.on("error", (err) => {
      simSpawnFailed = true;
      const msg = `evenhub-simulator spawn error: ${err instanceof Error ? err.message : String(err)}`;
      appendLogLines(processLogs, "sim:err", msg);
      if (!shuttingDown && !earlyChildError) {
        earlyChildError = new Error(msg);
      }
    });
    simChild.on("exit", (code, signal) => {
      if (!shuttingDown && !earlyChildError) {
        earlyChildError = new Error(
          `evenhub-simulator exited unexpectedly (code=${String(code ?? "null")}, signal=${String(signal ?? "null")})`,
        );
      }
    });

    const pingDeadline = Date.now() + timeouts.pingMs;
    let simReady = false;
    while (Date.now() < pingDeadline) {
      if (earlyChildError) throw earlyChildError;
      try {
        const res = await httpFetch(`${automationUrl}/api/ping`);
        const body = (await res.text()).trim();
        if (earlyChildError) throw earlyChildError;
        if (res.ok && body === "pong") {
          simReady = true;
          break;
        }
      } catch (err) {
        if (earlyChildError) throw earlyChildError;
        void err;
      }
      await sleep(200);
    }
    if (!simReady) {
      throw new Error(
        `Simulator automation API at ${automationUrl}/api/ping did not respond "pong" within ${timeouts.pingMs}ms`,
      );
    }
    steps.push({
      step: currentStep,
      status: "passed",
      detail: `Simulator automation API ready at ${automationUrl}`,
    });

    currentStep = "app_ready_and_initial_render";
    await pollConsoleUntil(
      "APP_READY and initial STATE",
      (all) =>
        all.some((e) =>
          e.message.includes("[device-lab] APP_READY mode=bridge"),
        ) &&
        all.some((e) =>
          e.message.includes(
            "[device-lab] STATE phase=READY taps=0 focus=0 status=ready seq=0 last=none origin=none",
          ),
        ),
      timeouts.consoleMs,
    );

    const initialGlasses = await waitGlassesFrame(
      "initial glasses render",
      (_bytes, decoded) => {
        const stats = analyzeGlassesFramebuffer(decoded);
        return (
          stats.litPixels >= 1000 &&
          stats.transparentPixels >= 100_000 &&
          stats.litBandCounts.top > 0 &&
          stats.litBandCounts.middle > 0 &&
          stats.litBandCounts.bottom > 0
        );
      },
      timeouts.screenshotMs,
    );
    const initialStats = analyzeGlassesFramebuffer(initialGlasses.decoded);
    if (initialStats.litPixels > 80_000) {
      throw new Error(
        `Initial glasses framebuffer has suspiciously high litPixels=${initialStats.litPixels}`,
      );
    }
    await writeArtifact("glasses-initial.png", initialGlasses.bytes);

    const webviewInitialBytes = await fetchBytes("/api/screenshot/webview");
    const webviewInitialDecoded = decodePngRgba(webviewInitialBytes);
    if (
      webviewInitialDecoded.width < 200 ||
      webviewInitialDecoded.height < 200 ||
      !hasImageVariance(webviewInitialDecoded)
    ) {
      throw new Error(
        `Initial webview screenshot failed sanity check (${webviewInitialDecoded.width}x${webviewInitialDecoded.height})`,
      );
    }
    await writeArtifact("webview-initial.png", webviewInitialBytes);

    steps.push({
      step: currentStep,
      status: "passed",
      detail: `APP_READY=bridge; glasses 576x288 RGBA litPixels=${initialStats.litPixels}, transparentPixels=${initialStats.transparentPixels}`,
      metrics: {
        litPixels: initialStats.litPixels,
        transparentPixels: initialStats.transparentPixels,
        litBounds: initialStats.litBounds,
        litBandCounts: initialStats.litBandCounts,
        webviewSize: `${webviewInitialDecoded.width}x${webviewInitialDecoded.height}`,
      },
    });

    /**
     * Helper to inject an action, assert expected console state, and verify localized RGBA framebuffer diff.
     * @param {{
     *   stepName: string,
     *   action: string,
     *   expectedStateSubstring: string,
     *   artifactFile: string,
     *   prevDecoded: ReturnType<typeof decodePngRgba>,
     *   minChangedPixels: number,
     *   maxChangedPixels: number,
     *   requireTopChange?: boolean,
     *   requireMiddleOrBottomChange?: boolean,
     * }} cfg
     */
    const runInputStep = async (cfg) => {
      currentStep = cfg.stepName;
      const startIndex = capturedConsole.length;
      await sendInput(cfg.action);
      await pollConsoleUntil(
        `${cfg.stepName} (${cfg.action})`,
        (all) =>
          all
            .slice(startIndex)
            .some((e) => e.message.includes(cfg.expectedStateSubstring)),
        timeouts.consoleMs,
      );

      let latestDiff =
        /** @type {ReturnType<typeof diffRgbaBuffers> | null} */ (null);
      const frame = await waitGlassesFrame(
        `${cfg.stepName} framebuffer update`,
        (_bytes, decoded) => {
          analyzeGlassesFramebuffer(decoded);
          const diff = diffRgbaBuffers(cfg.prevDecoded, decoded);
          latestDiff = diff;
          return diff.changedPixels >= cfg.minChangedPixels;
        },
        timeouts.screenshotMs,
      );
      const diff =
        latestDiff ?? diffRgbaBuffers(cfg.prevDecoded, frame.decoded);
      if (diff.changedPixels > cfg.maxChangedPixels) {
        throw new Error(
          `${cfg.stepName}: changedPixels=${diff.changedPixels} exceeded max ${cfg.maxChangedPixels}`,
        );
      }
      if (cfg.requireTopChange && diff.changedBandCounts.top === 0) {
        throw new Error(`${cfg.stepName}: expected pixel changes in top band`);
      }
      if (
        cfg.requireMiddleOrBottomChange &&
        diff.changedBandCounts.middle + diff.changedBandCounts.bottom === 0
      ) {
        throw new Error(
          `${cfg.stepName}: expected pixel changes in middle/bottom band`,
        );
      }
      await writeArtifact(cfg.artifactFile, frame.bytes);
      steps.push({
        step: cfg.stepName,
        action: cfg.action,
        status: "passed",
        detail: `${cfg.action} updated state & framebuffer (${diff.changedPixels} changed pixels)`,
        metrics: {
          changedPixels: diff.changedPixels,
          alphaChangedPixels: diff.alphaChangedPixels,
          changedBounds: diff.changedBounds,
          changedBandCounts: diff.changedBandCounts,
        },
      });
      return frame.decoded;
    };

    let currentGlasses = initialGlasses.decoded;
    currentGlasses = await runInputStep({
      stepName: "input_click_1",
      action: "click",
      expectedStateSubstring:
        "[device-lab] STATE phase=ACTIVE taps=1 focus=0 status=ready seq=1 last=tap",
      artifactFile: "glasses-after-click.png",
      prevDecoded: currentGlasses,
      minChangedPixels: 40,
      maxChangedPixels: 40_000,
      requireTopChange: true,
      requireMiddleOrBottomChange: true,
    });

    currentGlasses = await runInputStep({
      stepName: "input_down",
      action: "down",
      expectedStateSubstring:
        "[device-lab] STATE phase=ACTIVE taps=1 focus=1 status=ready seq=2 last=scroll_down origin=unknown",
      artifactFile: "glasses-after-down.png",
      prevDecoded: currentGlasses,
      minChangedPixels: 30,
      maxChangedPixels: 40_000,
    });

    currentGlasses = await runInputStep({
      stepName: "input_up",
      action: "up",
      expectedStateSubstring:
        "[device-lab] STATE phase=ACTIVE taps=1 focus=0 status=ready seq=3 last=scroll_up origin=unknown",
      artifactFile: "glasses-after-up.png",
      prevDecoded: currentGlasses,
      minChangedPixels: 30,
      maxChangedPixels: 40_000,
    });

    currentGlasses = await runInputStep({
      stepName: "input_long_press",
      action: "long_press",
      expectedStateSubstring:
        "[device-lab] STATE phase=ACTIVE taps=1 focus=0 status=ready seq=4 last=long_press",
      artifactFile: "glasses-after-long-press.png",
      prevDecoded: currentGlasses,
      minChangedPixels: 20,
      maxChangedPixels: 40_000,
    });

    currentGlasses = await runInputStep({
      stepName: "input_long_press_release",
      action: "long_press_release",
      expectedStateSubstring:
        "[device-lab] STATE phase=ACTIVE taps=1 focus=0 status=ready seq=5 last=long_press_release",
      artifactFile: "glasses-after-long-press-release.png",
      prevDecoded: currentGlasses,
      minChangedPixels: 20,
      maxChangedPixels: 40_000,
    });

    await runInputStep({
      stepName: "input_click_2",
      action: "click",
      expectedStateSubstring:
        "[device-lab] STATE phase=READY taps=2 focus=0 status=ready seq=6 last=tap",
      artifactFile: "glasses-after-click-2.png",
      prevDecoded: currentGlasses,
      minChangedPixels: 40,
      maxChangedPixels: 40_000,
      requireTopChange: true,
    });

    currentStep = "capture_final_webview";
    const webviewFinalBytes = await fetchBytes("/api/screenshot/webview");
    const webviewFinalDecoded = decodePngRgba(webviewFinalBytes);
    if (!hasImageVariance(webviewFinalDecoded)) {
      throw new Error("Final webview screenshot is uniform/blank");
    }
    await writeArtifact("webview-final.png", webviewFinalBytes);
    steps.push({
      step: currentStep,
      status: "passed",
      detail: `Final webview screenshot captured (${webviewFinalDecoded.width}x${webviewFinalDecoded.height})`,
    });

    currentStep = "drain_final_console";
    const trailingEntries = await drainConsoleOnce("final console drain");
    steps.push({
      step: currentStep,
      status: "passed",
      detail: `Final console drained cleanly (+${trailingEntries.length} trailing entries, ${capturedConsole.length} total)`,
    });
  } catch (err) {
    failedStep = currentStep;
    errorMsg = redactOutput(err instanceof Error ? err.message : String(err));
    steps.push({
      step: currentStep,
      status: "failed",
      detail: errorMsg,
    });

    if (automationUrl) {
      try {
        const res = await httpFetch(
          `${automationUrl}/api/console?since_id=${consoleCursor}`,
        );
        if (res.ok) {
          const payload = /** @type {{ entries?: ConsoleEntry[] }} */ (
            await res.json()
          );
          if (Array.isArray(payload.entries)) {
            for (const item of payload.entries) {
              if (
                typeof item?.id === "number" &&
                !seenConsoleIds.has(item.id)
              ) {
                seenConsoleIds.add(item.id);
                capturedConsole.push({
                  ...item,
                  message: redactOutput(String(item.message ?? "")),
                });
              }
            }
          }
        }
      } catch {
        // Best effort failure capture.
      }
      try {
        await writeArtifact(
          "glasses-on-failure.png",
          await fetchBytes("/api/screenshot/glasses"),
        );
      } catch {
        // Best effort failure capture.
      }
      try {
        await writeArtifact(
          "webview-on-failure.png",
          await fetchBytes("/api/screenshot/webview"),
        );
      } catch {
        // Best effort failure capture.
      }
    }
  } finally {
    shuttingDown = true;
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);

    const cleanup = /** @type {ProcessExitRecord[]} */ ([]);
    cleanup.push(
      await terminateChild(
        simSpawnFailed ? null : simChild,
        "evenhub-simulator",
        timeouts.graceKillMs,
        detached,
      ),
    );
    cleanup.push(
      await terminateChild(
        viteSpawnFailed ? null : viteChild,
        "vite",
        timeouts.graceKillMs,
        detached,
      ),
    );

    const finishedAt = nowIso();
    summary = {
      status: failedStep === null ? "passed" : "failed",
      startedAt,
      finishedAt,
      durationMs: Date.now() - startMs,
      devUrl,
      automationUrl,
      artifactDir,
      failedStep,
      error: errorMsg,
      steps,
      cleanup,
    };

    try {
      await mkdir(artifactDir, { recursive: true });
      await writeFile(
        join(artifactDir, "console.json"),
        `${JSON.stringify(capturedConsole, null, 2)}\n`,
      );
      await writeFile(
        join(artifactDir, "process.log"),
        `${processLogs.join("\n")}\n`,
      );
      await writeFile(
        join(artifactDir, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
    } catch {
      // Do not mask the primary failure if artifact directory is unwritable.
    }
  }

  return summary;
}
