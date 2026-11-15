// Generates a QR code for an explicitly provided phone-reachable URL (blueprint §6.4).
// Never guesses LAN interfaces implicitly or uploads anything.
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evenhubBin = join(root, "node_modules", ".bin", "evenhub");

const rawArgs = process.argv.slice(2);
const urlIndex = rawArgs.indexOf("--url");
const explicitUrl =
  urlIndex >= 0
    ? rawArgs[urlIndex + 1]
    : rawArgs.find((a) => !a.startsWith("-"));

if (!explicitUrl) {
  console.error(
    "Usage: corepack yarn qr:lab --url http://<lan-ip>:5173\n" +
      "Start the LAN dev server separately with: corepack yarn dev:lab -- --host 0.0.0.0",
  );
  process.exitCode = 1;
} else {
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
    console.error(
      `Invalid URL "${explicitUrl}". Expected http:// or https:// URL.`,
    );
    process.exitCode = 1;
  } else {
    execFile(
      evenhubBin,
      ["qr", "--url", parsed.toString()],
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
