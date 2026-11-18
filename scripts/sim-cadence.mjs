// Starts the Cadence Vite dev server (port 5174) and attaches the project-local EvenHub simulator.
// Cleans up spawned child processes on exit; never kills unrelated processes on a busy port.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePortEnv } from "./sim-harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "cadence");
const viteBin = join(root, "node_modules", ".bin", "vite");
const simBin = join(root, "node_modules", ".bin", "evenhub-simulator");

/**
 * @param {string | undefined} rawHost
 * @param {string | undefined} rawPort
 * @param {readonly string[]} rawArgs
 * @returns {{ host: string, port: number, targetUrl: string, extraSimArgs: string[] }}
 */
export function resolveSimCadenceTarget(rawHost, rawPort, rawArgs) {
  const host = (rawHost ?? "").trim() || "0.0.0.0";
  const port = parsePortEnv("DEV_PORT", rawPort, 5174) ?? 5174;
  const connectHost =
    host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  const formattedConnectHost =
    connectHost.includes(":") && !connectHost.startsWith("[")
      ? `[${connectHost}]`
      : connectHost;
  const targetUrl = `http://${formattedConnectHost}:${port}`;
  const extraSimArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : [...rawArgs];
  return { host, port, targetUrl, extraSimArgs };
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @param {() => boolean} shouldAbort
 * @returns {Promise<void>}
 */
async function waitForHttpReady(url, timeoutMs, shouldAbort) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !shouldAbort()) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // Server still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (shouldAbort()) {
    return;
  }
  throw new Error(
    `Cadence dev server at ${url} did not become ready within ${timeoutMs}ms`,
  );
}

const isDirectRun = (() => {
  if (typeof process.argv[1] !== "string" || !process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const { host, port, targetUrl, extraSimArgs } = resolveSimCadenceTarget(
    process.env.DEV_HOST,
    process.env.DEV_PORT,
    process.argv.slice(2),
  );

  const detached = process.platform !== "win32";
  const vite = spawn(
    viteBin,
    ["--host", host, "--port", String(port), "--strictPort"],
    {
      cwd: appDir,
      stdio: "inherit",
      shell: false,
      detached,
    },
  );

  /** @type {import("node:child_process").ChildProcess | null} */
  let sim = null;
  let shuttingDown = false;

  /**
   * @param {import("node:child_process").ChildProcess | null} child
   */
  function killChildTree(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (detached && typeof child.pid === "number" && child.pid > 0) {
      try {
        process.kill(-child.pid, "SIGTERM");
        return;
      } catch {
        // Fall back to direct kill.
      }
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // Child may not have spawned.
    }
  }

  /** @param {number} code */
  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    killChildTree(sim);
    killChildTree(vite);
    process.exitCode = code;
  }

  vite.on("error", (err) => {
    if (!shuttingDown) {
      console.error(`[sim:cadence] Failed to start Vite: ${err.message}`);
      shutdown(1);
    }
  });

  vite.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(
        `[sim:cadence] Vite exited early (code ${code ?? "null"}). Check if port ${port} is already in use.`,
      );
      shutdown(code ?? 1);
    }
  });

  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));

  try {
    await waitForHttpReady(targetUrl, 10000, () => shuttingDown);
    if (!shuttingDown) {
      console.log(
        `[sim:cadence] Cadence ready at ${targetUrl} (Mac Operator URL: ${targetUrl}/?role=operator); launching simulator...`,
      );
      sim = spawn(simBin, ["--glow", ...extraSimArgs, targetUrl], {
        cwd: root,
        stdio: "inherit",
        shell: false,
        detached,
      });
      sim.on("error", (err) => {
        if (!shuttingDown) {
          console.error(
            `[sim:cadence] Failed to start evenhub-simulator: ${err.message}`,
          );
          shutdown(1);
        }
      });
      sim.on("exit", (code) => {
        shutdown(code ?? 0);
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sim:cadence] ${msg}`);
    shutdown(1);
  }
}
