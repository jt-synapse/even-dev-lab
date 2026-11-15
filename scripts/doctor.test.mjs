import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectReport,
  formatReport,
  inspectHardwareBaseline,
  redactOutput,
} from "./doctor.mjs";

/** @typedef {import("./doctor.mjs").Deps} Deps */

/**
 * A healthy fake machine. Individual tests override one behaviour.
 * @param {Partial<Deps>} [overrides]
 * @returns {Deps}
 */
function fakeDeps(overrides = {}) {
  const files = new Map([
    [".nvmrc", "24.22.1\n"],
    ["mise.toml", '[tools]\nnode = "24.22.1"\n'],
    ["package.json", JSON.stringify({ packageManager: "yarn@4.18.1" })],
  ]);
  /** @type {Deps} */
  const deps = {
    run: async (cmd, args) => {
      const ok = {
        code: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        missing: false,
      };
      if (cmd === "git" && args[0] === "--version")
        return { ...ok, stdout: "git version 2.56.0" };
      if (cmd === "git" && args[0] === "branch")
        return { ...ok, stdout: "main" };
      if (cmd === "git" && args[0] === "remote") return { ...ok, stdout: "" };
      if (cmd === "mise") return { ...ok, stdout: "2026.9.15 macos-arm64" };
      if (cmd === "corepack") return { ...ok, stdout: "4.18.1" };
      if (cmd.endsWith("node_modules/.bin/evenhub"))
        return { ...ok, stdout: "0.2.0" };
      if (cmd.endsWith("node_modules/.bin/evenhub-simulator"))
        return { ...ok, stdout: "0.9.5" };
      return ok;
    },
    readText: (rel) => files.get(rel) ?? null,
    exists: () => true,
    nodeVersion: "24.22.1",
    platform: "darwin",
    arch: "arm64",
    shell: "zsh",
    freeDiskBytes: 100 * 1024 ** 3,
    rootPath: "/repo/even-dev-lab",
  };
  return { ...deps, ...overrides };
}

/**
 * @param {Awaited<ReturnType<typeof collectReport>>} report
 * @param {string} name
 */
function checkNamed(report, name) {
  const found = report.checks.find((c) => c.name === name);
  assert.ok(found, `expected a check named ${name}`);
  return found;
}

test("healthy machine passes with hardware deferred, not failed", async () => {
  const report = await collectReport(fakeDeps());
  assert.equal(report.failures, 0);
  assert.equal(checkNamed(report, "hardware").status, "deferred");
  assert.equal(checkNamed(report, "even tooling").status, "ok");
  assert.match(formatReport(report), /foundation ready/);
});

test("configured git remote passes without warning", async () => {
  const base = fakeDeps();
  const report = await collectReport(
    fakeDeps({
      run: async (cmd, args, timeout) =>
        cmd === "git" && args[0] === "remote"
          ? {
              code: 0,
              stdout: "origin\n",
              stderr: "",
              timedOut: false,
              missing: false,
            }
          : base.run(cmd, args, timeout),
    }),
  );
  assert.equal(checkNamed(report, "git remote").status, "ok");
  assert.equal(report.warnings, 0);
});

test("missing git is a foundation failure", async () => {
  const base = fakeDeps();
  const report = await collectReport(
    fakeDeps({
      run: async (cmd, args, timeout) =>
        cmd === "git"
          ? {
              code: null,
              stdout: "",
              stderr: "",
              timedOut: false,
              missing: true,
            }
          : base.run(cmd, args, timeout),
    }),
  );
  assert.equal(checkNamed(report, "git").status, "fail");
  assert.ok(report.failures >= 1);
});

test("node version mismatch against the pin fails", async () => {
  const report = await collectReport(fakeDeps({ nodeVersion: "22.5.0" }));
  assert.equal(checkNamed(report, "node pin").status, "fail");
  assert.match(checkNamed(report, "node pin").detail, /pinned 24\.22\.1/);
});

test("mise and .nvmrc pin disagreement fails", async () => {
  const report = await collectReport(
    fakeDeps({
      readText: (rel) =>
        rel === "mise.toml"
          ? '[tools]\nnode = "22.5.0"\n'
          : fakeDeps().readText(rel),
    }),
  );
  assert.equal(checkNamed(report, "mise pin").status, "fail");
});

test("missing dependencies fail with an actionable hint", async () => {
  const report = await collectReport(
    fakeDeps({ exists: (rel) => rel !== "node_modules" }),
  );
  assert.equal(checkNamed(report, "dependencies").status, "fail");
  assert.match(
    checkNamed(report, "dependencies").detail,
    /corepack yarn install/,
  );
});

test("subprocess timeout is reported as a failure, not a crash", async () => {
  const base = fakeDeps();
  const report = await collectReport(
    fakeDeps({
      run: async (cmd, args, timeout) =>
        cmd === "corepack"
          ? {
              code: null,
              stdout: "",
              stderr: "",
              timedOut: true,
              missing: false,
            }
          : base.run(cmd, args, timeout),
    }),
  );
  assert.equal(checkNamed(report, "yarn pin").status, "fail");
  assert.match(checkNamed(report, "yarn pin").detail, /timed out/);
});

test("secret-shaped values are redacted everywhere", async () => {
  const secret = "hunter2hunter2";
  assert.equal(redactOutput(`API_KEY=${secret}`).includes(secret), false);
  assert.equal(
    redactOutput(`Authorization: Bearer ${secret}`).includes(secret),
    false,
  );
  const base = fakeDeps();
  const report = await collectReport(
    fakeDeps({
      run: async (cmd, args, timeout) => {
        if (cmd === "git" && args[0] === "--version") {
          return {
            code: 0,
            stdout: `git version 2.56.0 TOKEN=${secret}`,
            stderr: "",
            timedOut: false,
            missing: false,
          };
        }
        return base.run(cmd, args, timeout);
      },
    }),
  );
  assert.equal(formatReport(report).includes(secret), false);
});

test("complete 9/9 M4 matrix in TESTING.md promotes hardware check to ok", async () => {
  const fullMatrix = [
    "# Testing and evidence",
    "",
    "## Hardware matrix — M4 baseline complete (9 / 9)",
    "",
    "| Case | Status |",
    "| ---- | ------ |",
    "| Cold start | pass |",
    "| Repeated navigation | pass |",
    "| Long-press / release | pass |",
    "| Ring absent | pass |",
    "| Ring present | pass |",
    "| Disconnect / reconnect | pass |",
    "| Phone foreground / background | pass |",
    "| Screen lock / unlock | pass |",
    "| Network loss | pass |",
    "",
    "## Evidence record template",
  ].join("\n");

  const base = fakeDeps();
  const report = await collectReport(
    fakeDeps({
      readText: (rel) =>
        rel === "docs/testing/TESTING.md" ? fullMatrix : base.readText(rel),
    }),
  );
  const hw = checkNamed(report, "hardware");
  assert.equal(hw.status, "ok");
  assert.match(hw.detail, /9\/9 pass/);
  assert.match(formatReport(report), /M4 hardware baseline recorded/);
});

test("partial M4 matrix keeps hardware check deferred with zero failures", async () => {
  const partialMatrix = [
    "## Hardware matrix — partial",
    "| Case | Status |",
    "| ---- | ------ |",
    "| Cold start | pass |",
    "| Repeated navigation | pass |",
    "| Long-press / release | pass |",
    "| Ring absent | pass |",
    "| Ring present | pass |",
    "| Disconnect / reconnect | pending |",
    "| Phone foreground / background | pending |",
    "| Screen lock / unlock | pending |",
    "| Network loss | pending |",
  ].join("\n");

  const parsed = inspectHardwareBaseline(partialMatrix);
  assert.equal(parsed.status, "deferred");
  assert.match(parsed.detail, /5\/9 pass/);

  const base = fakeDeps();
  const report = await collectReport(
    fakeDeps({
      readText: (rel) =>
        rel === "docs/testing/TESTING.md" ? partialMatrix : base.readText(rel),
    }),
  );
  assert.equal(report.failures, 0);
  assert.equal(checkNamed(report, "hardware").status, "deferred");
});
