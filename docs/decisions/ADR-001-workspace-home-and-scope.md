# ADR-001: Workspace home and M0–M1 scope

Status: accepted (2026-11-14)

## Context

The blueprint left the permanent repository location open (§15, question 1) and was authored as a planning document only. A separate implementation request authorized the M0 inventory and M1 foundation, stopping before application development.

## Decision

- The lab lives in this repository (`/Users/synapse/EvenGlasses`), initialized on Git branch `main`.
- Per explicit user authorization (2026-11-14), M1 is committed as a clean baseline before M2 work begins and connected to `origin` (`https://github.com/jt-synapse/even-dev-lab.git`). GitHub Actions CI remains deferred to M5, and Git synchronization remains distinct from Even Hub login, package upload, tester invitations, or publication.
- The blueprint is preserved unchanged at `docs/WORKSPACE_BLUEPRINT.md` (SHA-256 verified across the move) and is excluded from formatting so it stays byte-identical.
- M1 scope is the foundation only: pins, checker, quality gate, documentation. No application, simulator wiring, packaging, backend, MCP server, agent framework, paid integration, upload, publication, or hardware changes.

## Consequences

- Projects will be designed and built from M2 onward, starting with one minimal diagnostic app under `apps/device-lab/` (vanilla TypeScript + Vite, with React opt-in per future app).
- Commits provide clean rollback points and commit hashes for M2+ evidence records; local `corepack yarn check` remains the gate until CI arrives in M5.

## Revisit trigger

A decision to change repository hosting, make a repository public, or restructure workspace layout.
