# ADR-005: Cadence AI interview copilot architecture and server-proxy boundary

Status: accepted (2026-11-17)

## Context

Following completion of the M4 hardware baseline (`docs/testing/TESTING.md` `HW-001`–`HW-009`), we are building **Cadence** (`apps/cadence`), an AI interview copilot for Even Realities G2 glasses and the R1 ring.

Cadence requires four coordinated runtime capabilities:

1. **R1 Ring Hold-to-Talk (`LONG_PRESS_EVENT` -> `LONG_PRESS_RELEASE_EVENT`):** Record spoken questions from a configurable microphone (`G2 16 kHz 4-mic array`, `iPhone mic`, or `Mac mic`), transcribe speech-to-text on release, and display grounded teleprompter talking points on the `576×288` G2 display.
2. **Mac Logitech Webcam Capture -> Vision Q&A:** Capture a still frame from a Logitech webcam connected to the Mac workstation, analyze it with a multimodal LLM alongside Knowledge Base context, and push the response to the iPhone/G2 session over LAN.
3. **Knowledge Base Grounding with Automatic Fallback:** Answer from personal Knowledge Base material (`[KB]`) when relevant chunks match, and fall back seamlessly to general domain expertise (`[GEN]`) when no relevant material exists.
4. **Secret Isolation (`CAP-014`, Blueprint §14):** Keep `GEMINI_API_KEY` strictly server-side on the Mac companion process, never bundled into client WebView assets.

## Decision

- Implement Cadence as an independent workspace package at `apps/cadence` (`@even-dev-lab/cadence`, `com.synapsefaster.cadence`), preserving `apps/device-lab` unchanged.
- Enforce the four-layer boundary from blueprint §3:
  - `apps/cadence/src/domain/*`: Pure TypeScript state machine (`copilot.ts`), Knowledge Base chunker/retriever (`knowledge-base.ts`), and `16 kHz` PCM-to-RIFF-WAV encoder (`wav.ts`) with zero Even SDK, DOM, or Node imports.
  - `apps/cadence/src/even/adapter.ts`: Thin `@evenrealities/even_hub_sdk@0.0.16` adapter managing serialized `createStartUpPageContainer` / `textContainerUpgrade` updates, `audioControl(isOpen, AudioInputSource)` streaming, and R1 gesture normalization.
  - `apps/cadence/src/server/*`: Local Node/Vite companion API middleware (`/api/cadence/*` + SSE `/api/cadence/events`) holding `GEMINI_API_KEY`, Knowledge Base storage (`apps/cadence/kb/*.md` + `fixtures/cadence-kb-sample.md`), Mac Logitech webcam relay (browser WebRTC operator station `?role=operator` + macOS `imagesnap`/`ffmpeg` AVFoundation fallback), and a provider-neutral `CopilotAiProvider` interface backed by `GeminiInteractionsProvider` (`gemini-4-hydrogen` + `gemini-3.5-transcribe` on `POST /v1/interactions`) and deterministic `MockCopilotProvider`.
  - `apps/cadence/src/ui/phone-view.ts`: Dark-surface companion WebView & Mac Operator Station UI.

## Consequences

- `corepack yarn check` and simulator verification run 100% offline with zero credentials via `MockCopilotProvider` and synthetic test frames, while setting `GEMINI_API_KEY` in `.env.local` enables live Gemini transcription, webcam vision, and KB Q&A.
- iPhone Even App WebView and the Mac Operator browser tab stay synchronized in real time via SSE so R1 ring single-taps on the glasses/ring remotely trigger the Mac's Logitech webcam and push the resulting answer back to the G2 lenses.

## Revisit trigger

Extracting shared utilities into `packages/*` if a third application duplicates WAV encoding or server SSE sync, or adding a second `CopilotAiProvider` implementation.
