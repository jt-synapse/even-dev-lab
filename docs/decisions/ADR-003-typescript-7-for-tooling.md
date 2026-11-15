# ADR-003: TypeScript compiler pin (7.0.2 in M1 -> 6.0.3 in M2)

Status: superseded in M2 by planned step-down to **TypeScript 6.0.3** (2026-11-14)

## M1 context

TypeScript 7.0.2 was the registry-latest compiler during M1, when TypeScript had a single job: strict `checkJs` checking over `scripts/` with no application code, Even SDK types, Vite build, or TypeScript ESLint parser involved.

## M2 entry-gate execution (2026-11-14)

Before `apps/device-lab` adopted the compiler pin, we executed the three M2 gate checks defined in M1:

1. **TypeScript lint tooling compatibility (`typescript-eslint@8.72.2` under `eslint@10.14.0`):** `typescript-eslint@8.72.2` (registry latest) supports `eslint: "^10.0.0"`, but declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. Keeping `7.0.2` triggered the exact compatibility friction anticipated by the M1 revisit rule.
2. **Official Even template (`even-realities/evenhub-templates` `minimal/` @ `8cb01354f5ee914c5fab97d06e6d13b28eeb5815`):** Checked with `typescript@6.0.3`, `@evenrealities/even_hub_sdk@0.0.16`, and `vite@8.3.8` — `tsc --noEmit` exited `0` and `vite build` succeeded cleanly.
3. **Installed SDK type definitions (`@evenrealities/even_hub_sdk@0.0.16` `dist/index.d.ts`):** Checked cleanly under `typescript@6.0.3` `--strict` (`erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`) alongside `apps/device-lab` and Node 24's native type-stripping test runner (`node --test`).

## Decision

Step `typescript` from `7.0.2` to **`6.0.3`** (newest release within `<6.1.0`) across root and `apps/device-lab`, and pin `typescript-eslint` **`8.72.2`**. Revisit TypeScript 7 only after `typescript-eslint` publishes stable peer support for `>=7.0.0`.
