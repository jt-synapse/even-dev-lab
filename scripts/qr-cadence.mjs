// Generates an Even App QR code for Cadence (`http://<mac-lan-ip>:5174`) and prints the Mac Operator URL.
// Never guesses LAN interfaces implicitly or uploads anything.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseQrLabArgs } from "./qr-lab.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evenhubBin = join(root, "node_modules", ".bin", "evenhub");

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
    console.error(
      "Usage: corepack yarn qr:cadence --url http://<mac-lan-ip>:5174\n" +
        "Start Cadence on LAN separately with: DEV_HOST=0.0.0.0 corepack yarn dev:cadence",
    );
    process.exitCode = 1;
  } else {
    if (result.isLoopback) {
      console.error(
        `[qr:cadence] Warning: ${result.hostname} is loopback-only and will not be reachable from your iPhone over Wi-Fi.`,
      );
    }
    const parsed = new URL(result.url);
    const port = parsed.port || "5174";
    console.log(
      `[qr:cadence] Mac Logitech Webcam Operator URL: http://localhost:${port}/?role=operator`,
    );
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
