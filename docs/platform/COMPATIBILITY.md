# Compatibility record

All versions below were verified against npm registry metadata and installed/exercised in this repository on **2026-11-14** under `corepack yarn check` and live M2 simulator verification.

## Pinned workspace toolchain & M2 dependencies

| Tool / Package                     | Version | Owner                       | Verification status (2026-11-14)                                                                           |
| ---------------------------------- | ------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Node                               | 24.22.1 | `mise.toml`, `.nvmrc`, root | Active LTS runtime; native TS type-stripping (`node --test`) exercised in `check`                          |
| Yarn                               | 4.18.1  | `package.json` (Corepack)   | `node-modules` linker, single `yarn.lock`                                                                  |
| Prettier                           | 3.10.1  | root `devDependencies`      | Exercised by `format:check`                                                                                |
| ESLint                             | 10.14.0 | root `devDependencies`      | Exercised by `lint` (10.15.0 was inside Yarn's 24 h `npmMinimalAgeGate` quarantine — ADR-002)              |
| `@eslint/js`                       | 10.0.1  | root `devDependencies`      | Exercised by `lint`                                                                                        |
| `typescript-eslint`                | 8.72.2  | root `devDependencies`      | Exercised over `.ts` files + domain SDK/DOM import boundary rules                                          |
| TypeScript                         | 6.0.3   | root + `apps/device-lab`    | Stepped down from M1's `7.0.2` to satisfy `typescript-eslint@8.72.2` peer `<6.1.0` — see ADR-003           |
| `@types/node`                      | 24.19.2 | root + `apps/device-lab`    | Node 24 types line                                                                                         |
| `vite`                             | 8.3.8   | `apps/device-lab`           | Builds `apps/device-lab` and official `minimal` template cleanly on Node 24.22.1                           |
| `@evenrealities/even_hub_sdk`      | 0.0.16  | `apps/device-lab`           | Types verified (`dist/index.d.ts`); exercised in adapter tests and live simulator (`minAppVersion` 2.2.10) |
| `@evenrealities/evenhub-cli`       | 0.2.0   | `apps/device-lab`           | Project-local `node_modules/.bin/evenhub`; verified `--version`, `qr --url`, and `pack --sdk-ver 0.0.16`   |
| `@evenrealities/evenhub-simulator` | 0.9.5   | `apps/device-lab`           | Project-local (`sim-darwin-arm64@0.9.5`); verified `--version`, GUI/WebView startup, and HTTP API          |

## External reference snapshots inspected in M2

- **Official templates:** `even-realities/evenhub-templates` @ `8cb01354f5ee914c5fab97d06e6d13b28eeb5815` — `minimal/` typechecked (`tsc --noEmit`) and built (`vite build`) cleanly against our pinned `typescript@6.0.3`, `even_hub_sdk@0.0.16`, and `vite@8.3.8`.
- **Official agent skills:** `even-realities/everything-evenhub` @ `cb8321fbe2a11d5aaf08fa12088cbe9b9fc5bac2` (MIT License) — evaluated in M2 and adapted into four portable workspace skills under `.agents/skills/` (`evenhub-sdk-and-ui`, `evenhub-input-and-lifecycle`, `evenhub-simulator`, `evenhub-cli-local`) rewritten for `corepack yarn`, exact SDK `0.0.16` types, and strict local-only CLI rules.

## Verified M4 hardware baseline (2026-11-15)

| Component          | Version / Model                  | Verification status (2026-11-15)                                                                                 |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Phone / OS         | `iPhone 17 Pro Max` / `iOS 27.2` | Exercised across all `9 / 9` M4 cases against static `apps/device-lab` (`976de10`)                               |
| Even companion app | `v2.4.0`                         | Satisfies SDK `0.0.16` `minAppVersion` (`2.2.10`); `onLaunchSource("appMenu")`, `onDeviceStatusChanged` verified |
| Even G2 firmware   | `2.4.0.24`                       | Crisp `576×288` border/text, `eventSource` `1`/`3` on `sysEvent`, `textEvent` scrolls (`1`/`2`) verified         |
| Even R1 firmware   | `2.3.2.0008`                     | `eventSource: 2` (`ring`) on tap, double-tap, long-press/release; `textEvent` omits `eventSource`                |

Untested Android devices, other iOS releases, and future Even App / G2 / R1 firmware updates remain outside this baseline.
