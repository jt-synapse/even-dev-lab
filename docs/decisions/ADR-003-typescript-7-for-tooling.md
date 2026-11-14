# ADR-003: TypeScript 7.0.2 for M1 tooling

Status: accepted for M1 (2026-11-14), with an explicit M2 revisit

## Context

TypeScript 7.0.2 is the registry-latest compiler. In M1, TypeScript has exactly one job: strict `checkJs` type-checking of the plain-JavaScript tooling in `scripts/` (the doctor must run before dependencies exist, so it is not itself written in TypeScript). No application code, SDK types, Vite build, or TypeScript lint tooling is involved yet.

## Decision

Pin TypeScript **7.0.2** for M1. The compatibility surface in this milestone is only the checker against our own JSDoc-typed scripts, which `corepack yarn check` exercises.

## Revisit trigger (M2 entry gate)

Before the diagnostic app adopts this pin, verify at M2:

1. The official Even template builds and type-checks with 7.0.2.
2. The SDK 0.0.16 type definitions check cleanly under it.
3. Chosen TypeScript lint tooling supports it.

If any check produces friction, downgrade to the newest compiler line that passes all three and update this ADR. The downgrade is a single pin change plus a lockfile update; nothing in M1 depends on TypeScript 7 specifics.
