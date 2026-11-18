// Pure Knowledge Base markdown chunker and lexical relevance retriever (zero SDK/DOM/Node globals).

export interface KnowledgeDocument {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

export interface KnowledgeChunk {
  readonly docId: string;
  readonly docTitle: string;
  readonly heading: string;
  readonly text: string;
}

export interface ScoredKnowledgeChunk {
  readonly chunk: KnowledgeChunk;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export interface KnowledgeRetrievalResult {
  readonly hasRelevantMatch: boolean;
  readonly matchedChunks: readonly ScoredKnowledgeChunk[];
  readonly totalChunksSearched: number;
}

const STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "describe",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "explain",
  "for",
  "from",
  "further",
  "give",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "please",
  "question",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "time",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "walk",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
]);

const SHORT_TECH_ALLOWLIST = new Set([
  "ai",
  "ci",
  "cd",
  "db",
  "g2",
  "go",
  "id",
  "io",
  "js",
  "kb",
  "ml",
  "os",
  "qa",
  "r1",
  "ts",
  "ui",
  "ux",
  "vm",
]);

const MAX_CHUNK_CHARS = 900;
export const MIN_KB_RELEVANCE_SCORE = 1.6;

/**
 * Normalize and tokenize text into searchable terms while preserving technical identifiers.
 */
export function tokenizeSearchTerms(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.-]+/g, " ")
    .trim();
  if (!cleaned) {
    return [];
  }
  const rawTokens = cleaned.split(/\s+/);
  const result: string[] = [];
  for (const raw of rawTokens) {
    const token = raw.replace(/^[.-]+|[.-]+$/g, "");
    if (!token || STOP_WORDS.has(token)) {
      continue;
    }
    if (token.length < 3 && !SHORT_TECH_ALLOWLIST.has(token)) {
      continue;
    }
    // Lightweight stem normalization for common plurals/gerunds to improve recall.
    const normalized =
      token.length > 5 && token.endsWith("ing")
        ? token.slice(0, -3)
        : token.length > 4 && token.endsWith("ed")
          ? token.slice(0, -2)
          : token.length > 4 && token.endsWith("s") && !token.endsWith("ss")
            ? token.slice(0, -1)
            : token;
    result.push(normalized);
  }
  return result;
}

/**
 * Split markdown or plain-text Knowledge Base documents into cohesive sections.
 */
export function chunkMarkdownDocuments(
  documents: readonly KnowledgeDocument[],
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  for (const doc of documents) {
    const lines = doc.content.split(/\r?\n/);
    let currentHeading = doc.title;
    let buffer: string[] = [];
    let bufferChars = 0;

    const flush = () => {
      const text = buffer.join("\n").trim();
      if (text.length > 0) {
        chunks.push({
          docId: doc.id,
          docTitle: doc.title,
          heading: currentHeading,
          text,
        });
      }
      buffer = [];
      bufferChars = 0;
    };

    for (const line of lines) {
      const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (headingMatch) {
        flush();
        currentHeading = (headingMatch[2] ?? doc.title).trim();
        continue;
      }

      if (
        bufferChars > 0 &&
        bufferChars + line.length + 1 > MAX_CHUNK_CHARS &&
        line.trim() === ""
      ) {
        flush();
        continue;
      }

      buffer.push(line);
      bufferChars += line.length + 1;

      if (bufferChars >= MAX_CHUNK_CHARS) {
        flush();
      }
    }

    flush();
  }

  return chunks;
}

/**
 * Retrieve the most relevant Knowledge Base chunks for an interview prompt.
 * Sets `hasRelevantMatch = false` when no chunk crosses `MIN_KB_RELEVANCE_SCORE`
 * so the caller knows to fall back cleanly to general domain knowledge (`[GEN]`).
 */
export function retrieveRelevantKbChunks(
  query: string,
  documents: readonly KnowledgeDocument[],
  maxChunks: number = 3,
): KnowledgeRetrievalResult {
  const chunks = chunkMarkdownDocuments(documents);
  const queryTerms = Array.from(new Set(tokenizeSearchTerms(query)));

  if (chunks.length === 0 || queryTerms.length === 0) {
    return {
      hasRelevantMatch: false,
      matchedChunks: [],
      totalChunksSearched: chunks.length,
    };
  }

  // Compute inverse document frequency across chunks so distinctive terms weigh more.
  const docFreq = new Map<string, number>();
  const chunkTermSets = chunks.map((chunk) => {
    const bodyTerms = tokenizeSearchTerms(chunk.text);
    const headingTerms = tokenizeSearchTerms(
      `${chunk.docTitle} ${chunk.heading}`,
    );
    const combined = new Set<string>([...bodyTerms, ...headingTerms]);
    for (const term of combined) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
    return {
      chunk,
      bodySet: new Set(bodyTerms),
      headingSet: new Set(headingTerms),
    };
  });

  const scored: ScoredKnowledgeChunk[] = [];
  for (const entry of chunkTermSets) {
    let score = 0;
    const matchedTerms: string[] = [];

    for (const qTerm of queryTerms) {
      const inHeading = entry.headingSet.has(qTerm);
      const inBody = entry.bodySet.has(qTerm);
      if (!inHeading && !inBody) {
        continue;
      }
      matchedTerms.push(qTerm);
      const df = docFreq.get(qTerm) ?? 1;
      const idf = 1 + Math.log((chunks.length + 1) / (df + 0.5));
      score += idf * (inHeading ? 1.6 : 1.0);
    }

    if (matchedTerms.length >= 2) {
      score += 0.6 * (matchedTerms.length - 1);
    }

    if (score > 0) {
      scored.push({
        chunk: entry.chunk,
        score: Math.round(score * 100) / 100,
        matchedTerms,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0]?.score ?? 0;
  const hasRelevantMatch = topScore >= MIN_KB_RELEVANCE_SCORE;

  return {
    hasRelevantMatch,
    matchedChunks: hasRelevantMatch ? scored.slice(0, maxChunks) : [],
    totalChunksSearched: chunks.length,
  };
}
