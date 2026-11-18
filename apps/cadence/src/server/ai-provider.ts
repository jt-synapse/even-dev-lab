// Provider-neutral AI Interview Copilot interface + Gemini Interactions API (v1) implementation.
// Keeps GEMINI_API_KEY strictly on the Mac Node process (CAP-014 / Blueprint §14).

import {
  retrieveRelevantKbChunks,
  type KnowledgeDocument,
  type ScoredKnowledgeChunk,
} from "../domain/knowledge-base.ts";
import type { GroundingMode } from "../domain/copilot.ts";

export interface AudioCopilotRequest {
  readonly audioWavBase64: string;
  readonly mimeType?: string;
  readonly hintTranscript?: string;
  readonly webcamImageBase64?: string;
  readonly webcamMimeType?: string;
  readonly documents: readonly KnowledgeDocument[];
}

export interface VisionCopilotRequest {
  readonly imageBase64: string;
  readonly mimeType: string;
  readonly prompt?: string;
  readonly documents: readonly KnowledgeDocument[];
}

export interface TextCopilotRequest {
  readonly question: string;
  readonly documents: readonly KnowledgeDocument[];
}

export interface CopilotAiResponse {
  readonly transcript: string;
  readonly answerBullets: readonly string[];
  readonly grounding: GroundingMode;
  readonly matchedKbHeadings: readonly string[];
  readonly providerName: string;
}

export interface CopilotAiProvider {
  readonly name: string;
  transcribeAndAnswerAudio(
    req: AudioCopilotRequest,
  ): Promise<CopilotAiResponse>;
  analyzeWebcamAndAnswer(req: VisionCopilotRequest): Promise<CopilotAiResponse>;
  answerTextQuestion(req: TextCopilotRequest): Promise<CopilotAiResponse>;
}

const GEMINI_INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1/interactions";
const GEMINI_API_REVISION = "2026-05-20";

interface InteractionContentPart {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mime_type?: string;
}

interface InteractionStep {
  readonly type?: string;
  readonly content?: readonly InteractionContentPart[];
}

interface InteractionApiPayload {
  readonly id?: string;
  readonly status?: string;
  readonly output_text?: string;
  readonly steps?: readonly InteractionStep[];
  readonly error?: { readonly message?: string };
}

function extractInteractionText(payload: InteractionApiPayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const chunks: string[] = [];
  for (const step of payload.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const part of step.content ?? []) {
      if (part.type === "text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

export function parseBulletsFromModelText(raw: string): string[] {
  const cleaned = raw
    .replace(/^```(?:markdown|text|json)?/gim, "")
    .replace(/```$/gim, "")
    .trim();
  if (!cleaned) {
    return ["No response text generated."];
  }

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^GROUNDING\s*:/i.test(line) &&
        !/^SUMMARY\s*:/i.test(line),
    );

  const bullets: string[] = [];
  for (const line of lines) {
    const stripped = line.replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (stripped) {
      bullets.push(stripped);
    }
  }
  return bullets.slice(0, 6);
}

function formatKbContextBlock(
  matches: readonly ScoredKnowledgeChunk[],
): string {
  return matches
    .map(
      (m, idx) =>
        `[KB Section ${idx + 1}: ${m.chunk.docTitle} — ${m.chunk.heading}]\n${m.chunk.text}`,
    )
    .join("\n\n");
}

function buildAnswerSystemInstruction(
  hasKbMatch: boolean,
  kbMatches: readonly ScoredKnowledgeChunk[],
): string {
  const baseRules = [
    "You are Cadence, a concise AI interview copilot rendering talking points onto 576x288 smart-glasses lenses.",
    "Output 3 to 5 crisp, first-person talking-point bullets (each bullet <= 16 words, plain text, starting with '- ').",
    "Never include preamble, markdown headings, or disclaimers.",
  ];

  if (hasKbMatch && kbMatches.length > 0) {
    return [
      ...baseRules,
      "Relevant candidate Knowledge Base material WAS found below.",
      "Ground your talking points directly in the candidate's specific metrics, architecture choices, and stories from this Knowledge Base:",
      "",
      formatKbContextBlock(kbMatches),
    ].join("\n");
  }

  return [
    ...baseRules,
    "No matching personal Knowledge Base entry was found for this question.",
    "Answer the question directly, accurately, and concisely using strong general engineering/interview knowledge.",
  ].join("\n");
}

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly sttModel?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
}

export class GeminiInteractionsProvider implements CopilotAiProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly sttModel: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || "gemini-4-hydrogen";
    this.sttModel = options.sttModel?.trim() || "gemini-3.5-transcribe";
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.name = `gemini (${this.model})`;
  }

  private async callInteractions(
    body: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.fetchFn(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Revision": GEMINI_API_REVISION,
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        store: false,
        ...body,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const json = (await res.json().catch(() => ({}))) as InteractionApiPayload;
    if (!res.ok) {
      const detail = json.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`Gemini Interactions API failed: ${detail}`);
    }
    const text = extractInteractionText(json);
    if (!text) {
      throw new Error("Gemini Interactions API returned empty model_output.");
    }
    return text;
  }

  private async transcribeAudio(
    audioWavBase64: string,
    mimeType: string,
  ): Promise<string> {
    try {
      const transcript = await this.callInteractions({
        model: this.sttModel,
        input: [
          {
            type: "audio",
            data: audioWavBase64,
            mime_type: mimeType,
          },
          {
            type: "text",
            text: "Transcribe the spoken interview question verbatim as plain text.",
          },
        ],
      });
      return transcript.trim();
    } catch {
      // Fallback to multimodal primary model if dedicated transcribe endpoint rejects format.
      const transcript = await this.callInteractions({
        model: this.model,
        generation_config: { thinking_level: "low" },
        input: [
          {
            type: "audio",
            data: audioWavBase64,
            mime_type: mimeType,
          },
          {
            type: "text",
            text: "Return ONLY the verbatim transcript of what is spoken in this audio.",
          },
        ],
      });
      return transcript.trim();
    }
  }

  async answerTextQuestion(
    req: TextCopilotRequest,
  ): Promise<CopilotAiResponse> {
    const question =
      req.question.trim() || "Summarize key candidate strengths.";
    const retrieval = retrieveRelevantKbChunks(question, req.documents, 3);
    const systemInstruction = buildAnswerSystemInstruction(
      retrieval.hasRelevantMatch,
      retrieval.matchedChunks,
    );

    const rawAnswer = await this.callInteractions({
      model: this.model,
      system_instruction: systemInstruction,
      generation_config: { thinking_level: "low" },
      input: question,
    });

    return {
      transcript: question,
      answerBullets: parseBulletsFromModelText(rawAnswer),
      grounding: retrieval.hasRelevantMatch ? "kb" : "general",
      matchedKbHeadings: retrieval.matchedChunks.map((m) => m.chunk.heading),
      providerName: this.name,
    };
  }

  async transcribeAndAnswerAudio(
    req: AudioCopilotRequest,
  ): Promise<CopilotAiResponse> {
    const mimeType = req.mimeType || "audio/wav";
    const transcript =
      req.hintTranscript?.trim() ||
      (await this.transcribeAudio(req.audioWavBase64, mimeType));

    if (req.webcamImageBase64) {
      return this.analyzeWebcamAndAnswer({
        imageBase64: req.webcamImageBase64,
        mimeType: req.webcamMimeType || "image/jpeg",
        prompt: transcript,
        documents: req.documents,
      });
    }

    return this.answerTextQuestion({
      question: transcript,
      documents: req.documents,
    });
  }

  async analyzeWebcamAndAnswer(
    req: VisionCopilotRequest,
  ): Promise<CopilotAiResponse> {
    const userPrompt =
      req.prompt?.trim() ||
      "Read the interview problem, code, or diagram in this webcam photo and provide concise talking points or solution steps.";

    const retrieval = retrieveRelevantKbChunks(userPrompt, req.documents, 3);
    const allKbSummary = req.documents
      .map((d) => `[${d.title}]\n${d.content.slice(0, 1200)}`)
      .join("\n\n")
      .slice(0, 3600);

    const systemInstruction = [
      "You are Cadence, an AI interview copilot analyzing a live Logitech webcam snapshot for 576x288 smart-glasses lenses.",
      "1. First output a line starting with 'SUMMARY: ' (< 65 chars) naming the question/code/diagram seen in the image.",
      "2. Second output 'GROUNDING: KB' if the candidate Knowledge Base below directly applies to answering it, otherwise 'GROUNDING: GENERAL'.",
      "3. Then output 3 to 5 concise talking-point or solution bullets starting with '- ' (each <= 16 words).",
      allKbSummary
        ? `\nCandidate Knowledge Base:\n${allKbSummary}`
        : "\nNo personal Knowledge Base loaded; use general domain expertise.",
    ].join("\n");

    const rawOutput = await this.callInteractions({
      model: this.model,
      system_instruction: systemInstruction,
      generation_config: { thinking_level: "low" },
      input: [
        {
          type: "image",
          data: req.imageBase64,
          mime_type: req.mimeType,
        },
        {
          type: "text",
          text: userPrompt,
        },
      ],
    });

    const summaryMatch = /^SUMMARY:\s*(.+)$/im.exec(rawOutput);
    const groundingMatch = /^GROUNDING:\s*(KB|GENERAL)\b/im.exec(rawOutput);
    const detectedKb =
      groundingMatch?.[1]?.toUpperCase() === "KB" || retrieval.hasRelevantMatch;

    return {
      transcript:
        summaryMatch?.[1]?.trim() ||
        req.prompt?.trim() ||
        "Webcam visual prompt",
      answerBullets: parseBulletsFromModelText(rawOutput),
      grounding: detectedKb ? "kb" : "general",
      matchedKbHeadings: retrieval.matchedChunks.map((m) => m.chunk.heading),
      providerName: this.name,
    };
  }
}

/**
 * Deterministic offline provider used when GEMINI_API_KEY is unset or in automated tests.
 * Exercises real Knowledge Base retrieval (`[KB]` vs `[GEN]`) without network calls.
 */
export class MockCopilotProvider implements CopilotAiProvider {
  readonly name = "mock-gemini-offline";

  async answerTextQuestion(
    req: TextCopilotRequest,
  ): Promise<CopilotAiResponse> {
    const question =
      req.question.trim() || "Tell me about retry storms and migration.";
    const retrieval = retrieveRelevantKbChunks(question, req.documents, 2);

    if (retrieval.hasRelevantMatch && retrieval.matchedChunks.length > 0) {
      const top = retrieval.matchedChunks[0]!;
      const extractedBullets = top.chunk.text
        .split(/\r?\n/)
        .map((l) => l.replace(/^[-*•]\s*/, "").trim())
        .filter((l) => l.length > 0)
        .slice(0, 4);

      return {
        transcript: question,
        answerBullets:
          extractedBullets.length > 0
            ? extractedBullets
            : [`From ${top.chunk.heading}: highlight measurable impact.`],
        grounding: "kb",
        matchedKbHeadings: retrieval.matchedChunks.map((m) => m.chunk.heading),
        providerName: this.name,
      };
    }

    return {
      transcript: question,
      answerBullets: [
        "Clarify constraints, scale, and target latency upfront.",
        "Walk through core data model and algorithmic trade-offs.",
        "Highlight failure handling, observability, and edge cases.",
      ],
      grounding: "general",
      matchedKbHeadings: [],
      providerName: this.name,
    };
  }

  async transcribeAndAnswerAudio(
    req: AudioCopilotRequest,
  ): Promise<CopilotAiResponse> {
    const defaultPrompt =
      req.audioWavBase64.length > 80
        ? "How did you handle payment webhook retry storms and zero-downtime migration?"
        : "Explain how you approach system reliability trade-offs.";
    const transcript = req.hintTranscript?.trim() || defaultPrompt;
    return this.answerTextQuestion({
      question: transcript,
      documents: req.documents,
    });
  }

  async analyzeWebcamAndAnswer(
    req: VisionCopilotRequest,
  ): Promise<CopilotAiResponse> {
    const prompt =
      req.prompt?.trim() ||
      "Logitech webcam snapshot: System design & coding whiteboard";
    const retrieval = retrieveRelevantKbChunks(prompt, req.documents, 2);

    if (retrieval.hasRelevantMatch && retrieval.matchedChunks.length > 0) {
      const top = retrieval.matchedChunks[0]!;
      return {
        transcript: prompt,
        answerBullets: [
          `Connect visual diagram to ${top.chunk.heading}.`,
          "Cite 42,000 events/sec streaming benchmark (<18ms p99).",
          "Detail partitioned workers and idempotency guarantees.",
        ],
        grounding: "kb",
        matchedKbHeadings: retrieval.matchedChunks.map((m) => m.chunk.heading),
        providerName: this.name,
      };
    }

    return {
      transcript: prompt,
      answerBullets: [
        "State input/output invariants visible on the whiteboard.",
        "Propose O(N) hash-indexed pass before optimizing space.",
        "Trace boundary cases and concurrency locks aloud.",
      ],
      grounding: "general",
      matchedKbHeadings: [],
      providerName: this.name,
    };
  }
}
