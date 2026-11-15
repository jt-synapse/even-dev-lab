// Generates a QR code for an explicitly provided phone-reachable URL (blueprint §6.4).
// Never guesses LAN interfaces implicitly or uploads anything.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evenhubBin = join(root, "node_modules", ".bin", "evenhub");

/**
 * Parse and validate CLI arguments for `qr:lab`.
 * @param {readonly string[]} rawArgs
 * @returns {
 *   | { ok: true, url: string, hostname: string, isLoopback: boolean }
 *   | { ok: false, error: string }
 * }
 */
export function parseQrLabArgs(rawArgs) {
  const urlFlagEquals = rawArgs.find((a) => a.startsWith("--url="));
  const urlIndex = rawArgs.indexOf("--url");

  /** @type {string | undefined} */
  let explicitUrl;
  if (urlFlagEquals !== undefined) {
    explicitUrl = urlFlagEquals.slice("--url=".length);
    if (!explicitUrl) {
      return {
        ok: false,
        error: 'Missing URL after "--url=". Expected http:// or https:// URL.',
      };
    }
  } else if (urlIndex >= 0) {
    const nextArg = rawArgs[urlIndex + 1];
    if (!nextArg || nextArg.startsWith("-")) {
      return {
        ok: false,
        error: 'Missing URL after "--url". Expected http:// or https:// URL.',
      };
    }
    explicitUrl = nextArg;
  } else {
    explicitUrl = rawArgs.find((a) => a !== "--" && !a.startsWith("-"));
  }

  if (!explicitUrl) {
    return {
      ok: false,
      error:
        "Usage: corepack yarn qr:lab --url http://<lan-ip>:5173\n" +
        "Start the LAN dev server separately with: DEV_HOST=0.0.0.0 corepack yarn dev:lab",
    };
  }

  let parsed;
  try {
    parsed = new URL(explicitUrl);
  } catch {
    parsed = null;
  }

  if (
    !parsed ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    return {
      ok: false,
      error: `Invalid URL "${explicitUrl}". Expected http:// or https:// URL.`,
    };
  }

  const isLoopback =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]";

  return {
    ok: true,
    url: parsed.toString(),
    hostname: parsed.hostname,
    isLoopback,
  };
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
  const result = parseQrLabArgs(process.argv.slice(2));
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
  } else {
    if (result.isLoopback) {
      console.error(
        `[qr:lab] Warning: ${result.hostname} is loopback-only and will not be reachable from a physical phone over LAN.`,
      );
    }
    execFile(
      evenhubBin,
      ["qr", "--url", result.url],
      { cwd: root, timeout: 10000, shell: false },
      (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        if (err) {
          process.exitCode = typeof err.code === "number" ? err.code : 1;
        }
      },
    );
  }
}
