# Synapse Candidate Interview Knowledge Base (Sample Fixture)

## Candidate Overview & Architecture Leadership

- Led distributed event-streaming platform migration handling 42,000 events/sec at p99 latency under 18ms.
- Reduced cloud compute spend by 34% ($410K/year) by consolidating Kafka consumers and tuning batch backpressure.
- Primary stack: TypeScript, Node.js, Rust, PostgreSQL, Redis, and WebRTC low-latency media pipelines.

## STAR Story: Incident Recovery & Zero-Downtime Migration

- **Situation:** Legacy payment webhook queue suffered retry storms during peak traffic spikes, causing 4% timeout rates.
- **Task:** Redesign ingestion and idempotency guarantees within 6 weeks with zero merchant downtime.
- **Action:** Introduced deterministic idempotency keys in PostgreSQL, partitioned outbox workers, and circuit-breaker jitter.
- **Result:** Cut webhook timeout rate from 4.0% to 0.01% across 12M daily transactions and eliminated on-call paging storms.

## Behavioral: Handling Disagreement on System Design

- Built side-by-side benchmark harness comparing WebSocket fan-out vs Server-Sent Events (SSE) for read-heavy telemetry.
- Aligned mobile and backend teams using measured battery and reconnect metrics rather than abstract debate, shipping 2 weeks ahead of schedule.

## Cadence Wearable Architecture Talking Points

- Uses Even Realities G2 (`576x288` monochrome green HUD, `16 kHz` 4-mic array) and R1 ring (`LONG_PRESS` hold-to-talk) over a thin SDK boundary.
- Keeps LLM credentials (`GEMINI_API_KEY`) strictly on the Mac LAN server while streaming concise 3-5 bullet teleprompter pages.
