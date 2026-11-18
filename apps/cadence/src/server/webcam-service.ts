// Mac Logitech webcam capture service:
// 1. Live Mac Operator browser tab relay (?role=operator via WebRTC getUserMedia)
// 2. Headless macOS AVFoundation CLI fallback (imagesnap / ffmpeg, bounded timeout, no shell)
// 3. Deterministic synthetic PNG fallback for simulator / automated tests

import { execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CapturedWebcamFrame {
  readonly imageBase64: string;
  readonly mimeType: string;
  readonly sourceLabel: string;
}

export interface OperatorRelayHooks {
  hasActiveWebcamOperator(): boolean;
  requestOperatorFrame(timeoutMs: number): Promise<CapturedWebcamFrame>;
}

// Valid 1x1 dark green PNG base64 used only as synthetic test card in mock/simulator runs.
const SYNTHETIC_TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function execFileBounded(
  cmd: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      { timeout: timeoutMs, maxBuffer: 256 * 1024, shell: false },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

async function tryCaptureViaImagesnap(): Promise<CapturedWebcamFrame | null> {
  const listRes = await execFileBounded("imagesnap", ["-l"], 3000);
  if (!listRes.ok && !listRes.stdout) {
    return null;
  }

  const lines = `${listRes.stdout}\n${listRes.stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const logitechDevice = lines.find((l) =>
    /logitech|brio|c920|c922|c930|streamcam/i.test(l),
  );

  const outPath = join(
    tmpdir(),
    `cadence-webcam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
  );
  const args = logitechDevice
    ? ["-q", "-w", "0.5", "-d", logitechDevice, outPath]
    : ["-q", "-w", "0.5", outPath];

  try {
    const snap = await execFileBounded("imagesnap", args, 6000);
    if (!snap.ok || !existsSync(outPath)) {
      return null;
    }
    const bytes = readFileSync(outPath);
    if (bytes.byteLength === 0) {
      return null;
    }
    return {
      imageBase64: bytes.toString("base64"),
      mimeType: "image/jpeg",
      sourceLabel: logitechDevice
        ? `imagesnap (${logitechDevice})`
        : "imagesnap (default Mac camera)",
    };
  } finally {
    try {
      if (existsSync(outPath)) unlinkSync(outPath);
    } catch {
      // Ignore temp cleanup error.
    }
  }
}

async function tryCaptureViaFfmpeg(): Promise<CapturedWebcamFrame | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  const probe = await execFileBounded(
    "ffmpeg",
    ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
    3500,
  );
  const combined = `${probe.stdout}\n${probe.stderr}`;
  if (!combined.includes("AVFoundation")) {
    return null;
  }

  // Parse `[0] Logitech BRIO` style video device lines before audio devices section.
  let selectedIndex = "0";
  let selectedLabel = "AVFoundation camera #0";
  const lines = combined.split(/\r?\n/);
  for (const line of lines) {
    if (/AVFoundation audio devices/i.test(line)) {
      break;
    }
    const match = /\[(\d+)\]\s+(.+)$/.exec(line);
    if (match) {
      const idx = match[1]!;
      const name = match[2]!.trim();
      if (/logitech|brio|c920|c922|c930|streamcam/i.test(name)) {
        selectedIndex = idx;
        selectedLabel = name;
        break;
      }
    }
  }

  const outPath = join(
    tmpdir(),
    `cadence-ffmpeg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
  );
  try {
    const snap = await execFileBounded(
      "ffmpeg",
      [
        "-y",
        "-f",
        "avfoundation",
        "-framerate",
        "30",
        "-i",
        `${selectedIndex}:none`,
        "-frames:v",
        "1",
        outPath,
      ],
      6500,
    );
    if (!snap.ok || !existsSync(outPath)) {
      return null;
    }
    const bytes = readFileSync(outPath);
    if (bytes.byteLength === 0) {
      return null;
    }
    return {
      imageBase64: bytes.toString("base64"),
      mimeType: "image/jpeg",
      sourceLabel: `ffmpeg (${selectedLabel})`,
    };
  } finally {
    try {
      if (existsSync(outPath)) unlinkSync(outPath);
    } catch {
      // Ignore temp cleanup error.
    }
  }
}

export interface CaptureMacWebcamOptions {
  readonly relay?: OperatorRelayHooks;
  readonly allowSyntheticFallback?: boolean;
  readonly forceSynthetic?: boolean;
}

export async function captureMacLogitechWebcam(
  options: CaptureMacWebcamOptions = {},
): Promise<CapturedWebcamFrame> {
  if (options.forceSynthetic || process.env.CADENCE_MOCK_WEBCAM === "1") {
    return {
      imageBase64: SYNTHETIC_TEST_PNG_BASE64,
      mimeType: "image/png",
      sourceLabel: "synthetic-logitech-test-card",
    };
  }

  if (options.relay?.hasActiveWebcamOperator()) {
    try {
      return await options.relay.requestOperatorFrame(4500);
    } catch {
      // Fall through to native CLI fallback if operator tab timed out.
    }
  }

  const viaImagesnap = await tryCaptureViaImagesnap();
  if (viaImagesnap) {
    return viaImagesnap;
  }

  const viaFfmpeg = await tryCaptureViaFfmpeg();
  if (viaFfmpeg) {
    return viaFfmpeg;
  }

  if (options.allowSyntheticFallback) {
    return {
      imageBase64: SYNTHETIC_TEST_PNG_BASE64,
      mimeType: "image/png",
      sourceLabel:
        "synthetic-fallback (open ?role=operator on Mac for Logitech WebRTC)",
    };
  }

  throw new Error(
    "No Logitech webcam capture source ready. Open http://localhost:5174/?role=operator in Chrome on your Mac to connect the Logitech webcam, or install imagesnap/ffmpeg.",
  );
}
