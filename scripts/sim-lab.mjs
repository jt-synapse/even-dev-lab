// Starts the device-lab Vite dev server and attaches the project-local EvenHub simulator.
// Cleans up spawned child processes on exit; never kills unrelated processes on a busy port.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "device-lab");
const viteBin = join(root, "node_modules", ".bin", "vite");
const simBin = join(root, "node_modules", ".bin", "evenhub-simulator");

const host = process.env.DEV_HOST || "127.0.0.1";
const port = Number(process.env.DEV_PORT || "5173");
const targetUrl = `http://${host}:${port}`;
const extraSimArgs = process.argv.slice(2);

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // Server still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Dev server at ${url} did not become ready within ${timeoutMs}ms`,
  );
}

const vite = spawn(
  viteBin,
  ["--host", host, "--port", String(port), "--strictPort"],
  {
    cwd: appDir,
    stdio: "inherit",
    shell: false,
  },
);

/** @type {import("node:child_process").ChildProcess | null} */
let sim = null;
let shuttingDown = false;

/** @param {number} code */
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (sim && sim.exitCode === null) {
    sim.kill("SIGTERM");
  }
  if (vite.exitCode === null) {
    vite.kill("SIGTERM");
  }
  process.exitCode = code;
}

vite.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(
      `[sim:lab] Vite exited early (code ${code ?? "null"}). Check if port ${port} is already in use.`,
    );
    shutdown(code ?? 1);
  }
});

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

try {
  await waitForHttpReady(targetUrl, 10000);
  if (!shuttingDown) {
    console.log(
      `[sim:lab] Dev server ready at ${targetUrl}; launching simulator...`,
    );
    sim = spawn(simBin, ["--glow", ...extraSimArgs, targetUrl], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    sim.on("exit", (code) => {
      shutdown(code ?? 0);
    });
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[sim:lab] ${msg}`);
  shutdown(1);
}
