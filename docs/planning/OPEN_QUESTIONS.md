# Open questions

From blueprint §15, updated after pre-M2 planning alignment (2026-11-14).

1. **Repository location** — **resolved.** This repository (`/Users/synapse/EvenGlasses`) is the lab's home (ADR-001).
2. **Primary coding-agent host and version** — **resolved.** Antigravity is the primary host, using portable `AGENTS.md` and `.agents/skills/<name>/SKILL.md` conventions. During M2, evaluate `even-realities/everything-evenhub` and vendor/adapt useful UI, font-measurement, and simulator skills to follow `corepack yarn` and no-publish rules.
3. **Phone OS/model, G2/R1 availability, installed app/firmware versions** — **resolved (2026-11-15, M4).** Verified on **`iPhone 17 Pro Max` (`iOS 27.2`)**, **`Even App v2.4.0`** (`>= 2.2.10` floor satisfied), **`Even G2 2.4.0.24`**, and **`Even R1 2.3.2.0008`** (`docs/platform/COMPATIBILITY.md`, `docs/testing/TESTING.md`). Android remains untested.
4. **Even developer access and local network connectivity** — **resolved (2026-11-15, M4).** Developer QR launcher in Even App `v2.4.0` connects cleanly over local Wi-Fi to the static `vite preview` server (`http://<lan-ip>:4173`), avoiding HMR WebSocket disconnects during `Network loss` testing.
5. **GitHub remote** — **resolved.** Remote `origin` is `https://github.com/jt-synapse/even-dev-lab.git` on branch `main` (ADR-001). GitHub Actions CI workflows remain deferred to M5; local `corepack yarn check` is the active gate.
6. **Exploration roadmap after diagnostic baseline** — **resolved.** Complete `apps/device-lab` + simulator automation (M2–M3) and hardware baseline (M4) first; subsequent experiments target phone-input HUD tools (including the §11 phone-paired Bluetooth keyboard, CAP-010), R1 ring micro-utilities, G2 `16 kHz` mic workflows (CAP-012), and phone-camera photo Q&A + LLM workflows backed by a local server-side API proxy (CAP-013, CAP-014).
