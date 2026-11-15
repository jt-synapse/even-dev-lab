import { defineConfig } from "vite";

function parsePortEnv(name: string, fallback: number): number {
  const raw = process.env[name];
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

const host = process.env.DEV_HOST?.trim() || "127.0.0.1";
const port = parsePortEnv("DEV_PORT", 5173);
const previewPort = parsePortEnv("PREVIEW_PORT", 4173);

export default defineConfig({
  server: {
    host,
    port,
    strictPort: true,
  },
  preview: {
    host,
    port: previewPort,
    strictPort: true,
  },
  build: {
    target: "esnext",
  },
});
