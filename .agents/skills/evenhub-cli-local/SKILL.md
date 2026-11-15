---
name: evenhub-cli-local
description: Author app.json manifests and run local-only Even Hub CLI (0.2.0) commands (qr, pack) via corepack yarn without triggering account login, uploads, tester invitations, or publication.
---

# Even Hub CLI (0.2.0) & Manifest Reference (Local Scope)

> Adapted for `even-dev-lab` from `even-realities/everything-evenhub` (`cb8321fbe2a11d5aaf08fa12088cbe9b9fc5bac2`, MIT License) and verified against installed `@evenrealities/evenhub-cli@0.2.0`.

## External Action Guardrail

- **Local commands** (`evenhub pack`, `evenhub qr --url <explicitUrl>`) do not require credentials and never upload.
- **External account/portal commands** (`login`, `logout`, `self-check`, `create`, `upload`, `update`, `promote`, `delist`, `testers`, `rm`, `download`) **must never be executed unless JT explicitly requests that specific external action.**
- Invoke via project-local workspace binaries (`corepack yarn qr:lab --url ...` or `corepack yarn workspace <pkg> exec evenhub ...`), never global `npm` or `npx`.

## `app.json` Manifest Contract (`edition: "202601"`)

```json
{
  "package_id": "com.synapsefaster.devicelab",
  "edition": "202601",
  "name": "Even Device Lab",
  "version": "0.1.0",
  "min_sdk_version": "0.0.16",
  "entrypoint": "index.html",
  "permissions": [],
  "supported_languages": ["en"]
}
```

- `package_id`: lowercase reverse-domain, `>= 2` segments, no hyphens, each segment starts with a lowercase letter.
- `name`: `1..20` Unicode code points.
- `version`: `x.y.z` semver.
- `min_sdk_version`: required; match the app's pinned `@evenrealities/even_hub_sdk` (`"0.0.16"`).
- `min_app_version`: optional; `evenhub pack --sdk-ver 0.0.16` stamps `2.2.10` into the `.ehpk` without mutating `app.json`.
- `permissions`: array of `{ "name": "<perm>", "desc": "<1..300 chars>" }` objects (never a key-value map). Valid permission names: `network` (supports `"whitelist": ["https://..."]`), `location`, `g2-microphone`, `phone-microphone`, `album`, `camera`. Declare `[]` unless the app uses that capability.

## Local Packaging Note

- Always write `.ehpk` outputs into `artifacts/` (gitignored) and pass `--sdk-ver 0.0.16` so offline/reproducible builds do not query unbounded `latest` on npm.
