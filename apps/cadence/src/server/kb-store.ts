// Server-side Knowledge Base loader and .env.local reader (Node runtime only).
// Never prints environment variables or secret values (AGENTS.md).

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { basename, extname, join } from "node:path";

import type { KnowledgeDocument } from "../domain/knowledge-base.ts";

/**
 * Load key=value pairs from `.env.local` / `.env` if not already set in `process.env`.
 */
export function loadLocalEnvFiles(paths: readonly string[]): void {
  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined && val !== "") {
        process.env[key] = val;
      }
    }
  }
}

export interface KnowledgeBaseStore {
  listDocuments(): KnowledgeDocument[];
  upsertNote(
    title: string,
    content: string,
    persistToDisk?: boolean,
  ): KnowledgeDocument;
}

export interface CreateKbStoreOptions {
  readonly kbDir: string;
  readonly sampleFixturePath: string;
}

function slugifyId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "session-note";
}

export function createKnowledgeBaseStore(
  options: CreateKbStoreOptions,
): KnowledgeBaseStore {
  const memoryNotes = new Map<string, KnowledgeDocument>();

  const readDiskDocs = (): KnowledgeDocument[] => {
    const docs: KnowledgeDocument[] = [];
    if (existsSync(options.kbDir)) {
      try {
        const entries = readdirSync(options.kbDir).sort();
        for (const entry of entries) {
          if (entry.toLowerCase() === "readme.md") continue;
          const ext = extname(entry).toLowerCase();
          if (ext !== ".md" && ext !== ".txt") continue;
          const fullPath = join(options.kbDir, entry);
          const content = readFileSync(fullPath, "utf8").trim();
          if (!content) continue;
          docs.push({
            id: `disk:${entry}`,
            title: basename(entry, ext),
            content,
          });
        }
      } catch {
        // Ignore unreadable directory entries.
      }
    }

    if (docs.length === 0 && existsSync(options.sampleFixturePath)) {
      try {
        const sampleContent = readFileSync(
          options.sampleFixturePath,
          "utf8",
        ).trim();
        if (sampleContent) {
          docs.push({
            id: "fixture:cadence-kb-sample",
            title: "Sample Interview Knowledge Base",
            content: sampleContent,
          });
        }
      } catch {
        // Ignore missing fixture.
      }
    }

    return docs;
  };

  return {
    listDocuments(): KnowledgeDocument[] {
      return [...Array.from(memoryNotes.values()), ...readDiskDocs()];
    },

    upsertNote(
      title: string,
      content: string,
      persistToDisk: boolean = false,
    ): KnowledgeDocument {
      const cleanTitle = title.trim() || "Interview Prep Note";
      const cleanContent = content.trim();
      const slug = slugifyId(cleanTitle);

      if (persistToDisk) {
        mkdirSync(options.kbDir, { recursive: true });
        const fileName = `${slug}.md`;
        writeFileSync(
          join(options.kbDir, fileName),
          `${cleanContent}\n`,
          "utf8",
        );
        return {
          id: `disk:${fileName}`,
          title: cleanTitle,
          content: cleanContent,
        };
      }

      const doc: KnowledgeDocument = {
        id: `note:${slug}`,
        title: cleanTitle,
        content: cleanContent,
      };
      memoryNotes.set(doc.id, doc);
      return doc;
    },
  };
}
