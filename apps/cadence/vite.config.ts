import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

import { createCadenceApiHandler } from "./src/server/api-middleware.ts";
import { createTypedSessionStore } from "./src/server/typed-session-store.ts";
import {
  createKnowledgeBaseStore,
  loadLocalEnvFiles,
} from "./src/server/kb-store.ts";

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(appDir, "..", "..");

loadLocalEnvFiles([
  join(appDir, ".env.local"),
  join(repoRoot, ".env.local"),
  join(appDir, ".env"),
  join(repoRoot, ".env"),
]);

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

function cadenceCompanionServerPlugin(): Plugin {
  const kbStore = createKnowledgeBaseStore({
    kbDir: join(appDir, "kb"),
    sampleFixturePath: join(repoRoot, "fixtures", "cadence-kb-sample.md"),
  });
  const typedSessionStore = createTypedSessionStore(
    process.env.CADENCE_TYPED_SESSION_DB?.trim() ||
      join(
        homedir(),
        "Library",
        "Application Support",
        "Cadence",
        "typed-sessions.sqlite",
      ),
  );
  const handler = createCadenceApiHandler({
    kbStore,
    typedSessionStore,
    allowSyntheticWebcamFallback: true,
  });

  return {
    name: "cadence-companion-api",
    configureServer(server) {
      server.httpServer?.once("close", () => typedSessionStore.close());
      server.middlewares.use((req, res, next) => {
        void handler(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.httpServer.once("close", () => typedSessionStore.close());
      server.middlewares.use((req, res, next) => {
        void handler(req, res, next);
      });
    },
  };
}

const host = process.env.DEV_HOST?.trim() || "127.0.0.1";
const port = parsePortEnv("DEV_PORT", 5174);
const previewPort = parsePortEnv("PREVIEW_PORT", 4174);

export default defineConfig({
  plugins: [cadenceCompanionServerPlugin()],
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
