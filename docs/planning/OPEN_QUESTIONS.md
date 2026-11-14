# Open questions

From blueprint §15, updated after pre-M2 planning alignment (2026-11-14).

1. **Repository location** — **resolved.** This repository (`/Users/synapse/EvenGlasses`) is the lab's home (ADR-001).
2. **Primary coding-agent host and version** — **resolved.** Antigravity is the primary host, using portable `AGENTS.md` and `.agents/skills/<name>/SKILL.md` conventions. During M2, evaluate `even-realities/everything-evenhub` and vendor/adapt useful UI, font-measurement, and simulator skills to follow `corepack yarn` and no-publish rules.
3. **Phone OS/model, G2/R1 availability, installed app/firmware versions** — **sequenced for M4.** M2–M3 validate in the local simulator first; physical G2/R1 hardware, phone OS, Even app (`>= 2.2.10` for SDK `0.0.16`), and firmware versions will be recorded at M4 entry.
4. **Even developer access and local network connectivity** — **sequenced for M4.** Not required for M2–M3 local simulator checks; verified before QR sideloading and M4 device testing.
5. **GitHub remote** — **resolved.** Remote `origin` is `https://github.com/jt-synapse/even-dev-lab.git` on branch `main` (ADR-001). GitHub Actions CI workflows remain deferred to M5; local `corepack yarn check` is the active gate.
6. **Exploration roadmap after diagnostic baseline** — **resolved.** Complete `apps/device-lab` + simulator automation (M2–M3) and hardware baseline (M4) first; subsequent experiments target phone-input HUD tools (including the §11 phone-paired Bluetooth keyboard, CAP-010), R1 ring micro-utilities, G2 `16 kHz` mic workflows (CAP-012), and phone-camera photo Q&A + LLM workflows backed by a local server-side API proxy (CAP-013, CAP-014).
