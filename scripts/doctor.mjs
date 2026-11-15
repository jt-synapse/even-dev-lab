// Environment and foundation readiness check (blueprint section 6.1/6.4).
// Plain JavaScript on purpose: it must run before dependencies are installed.
// It never prints environment dumps, credentials, or account configuration.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {"ok" | "warn" | "fail" | "deferred"} Status
 * @typedef {{ name: string, status: Status, detail: string }} Check
 * @typedef {{ code: number | null, stdout: string, stderr: string, timedOut: boolean, missing: boolean }} RunResult
 * @typedef {(cmd: string, args: string[], timeoutMs: number) => Promise<RunResult>} Runner
 * @typedef {{
 *   run: Runner,
 *   readText: (relPath: string) => string | null,
 *   exists: (relPath: string) => boolean,
 *   nodeVersion: string,
 *   platform: string,
 *   arch: string,
 *   shell: string,
 *   freeDiskBytes: number | null,
 *   rootPath: string,
 * }} Deps
 */

const SECRET_PATTERNS = [
  /([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*\s*[=:]\s*)\S+/gi,
  /(authorization\s*:\s*(?:bearer|basic)\s+)\S+/gi,
  /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
];

/**
 * Remove secret-shaped values so tool output is safe to show or log.
 * @param {string} text
 * @returns {string}
 */
export function redactOutput(text) {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_m, prefix) =>
      typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]",
    );
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string}
 */
function short(text) {
  const line = redactOutput(text).split(/\r?\n/)[0] ?? "";
  return line.trim().slice(0, 160);
}

/**
 * Default bounded subprocess runner. No shell, fixed argument lists only.
 * @type {Runner}
 */
export const defaultRunner = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024, shell: false },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({
            code: 0,
            stdout: String(stdout),
            stderr: String(stderr),
            timedOut: false,
            missing: false,
          });
          return;
        }
        const err =
          /** @type {NodeJS.ErrnoException & { killed?: boolean, code?: unknown }} */ (
            error
          );
        resolve({
          code: typeof err.code === "number" ? err.code : null,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          timedOut: Boolean(err.killed),
          missing: err.code === "ENOENT",
        });
      },
    );
  });

/**
 * @param {Deps} deps
 * @returns {Promise<{ checks: Check[], failures: number, warnings: number }>}
 */
export async function collectReport(deps) {
  /** @type {Check[]} */
  const checks = [];
  /** @param {string} name @param {Status} status @param {string} detail */
  const add = (name, status, detail) => {
    checks.push({ name, status, detail: redactOutput(detail) });
  };

  add("platform", "ok", `${deps.platform}/${deps.arch}`);
  add("shell", deps.shell ? "ok" : "warn", deps.shell || "unknown shell");
  if (deps.freeDiskBytes === null) {
    add("disk", "warn", "free disk space not checked");
  } else {
    const gib = (deps.freeDiskBytes / 1024 ** 3).toFixed(1);
    add(
      "disk",
      deps.freeDiskBytes > 1024 ** 3 ? "ok" : "warn",
      `${gib} GiB free`,
    );
  }
  add(
    "repo path",
    /\s/.test(deps.rootPath) ? "warn" : "ok",
    /\s/.test(deps.rootPath)
      ? "path contains spaces; some tooling may break"
      : "no spaces in path",
  );

  const git = await deps.run("git", ["--version"], 5000);
  if (git.missing) {
    add("git", "fail", "git not found on PATH");
  } else if (git.timedOut) {
    add("git", "fail", "git --version timed out");
  } else if (git.code !== 0) {
    add(
      "git",
      "fail",
      `git --version failed: ${short(git.stderr || git.stdout)}`,
    );
  } else {
    add("git", "ok", short(git.stdout));
    const branch = await deps.run("git", ["branch", "--show-current"], 5000);
    add(
      "git branch",
      branch.code === 0 && short(branch.stdout) ? "ok" : "fail",
      branch.code === 0 && short(branch.stdout)
        ? short(branch.stdout)
        : "not inside a Git work tree",
    );
    const remotes = await deps.run("git", ["remote"], 5000);
    const count =
      remotes.code === 0
        ? remotes.stdout.split(/\r?\n/).filter((l) => l.trim()).length
        : -1;
    add(
      "git remote",
      count < 0 ? "warn" : "ok",
      count < 0
        ? "could not list remotes"
        : count === 0
          ? "none configured (local-only)"
          : `${count} remote(s) configured (CI deferred to M5; Even Hub publishing remains manual)`,
    );
  }

  const expectedNode = (deps.readText(".nvmrc") ?? "").trim();
  if (!expectedNode) {
    add("node pin", "fail", ".nvmrc missing or empty");
  } else if (deps.nodeVersion !== expectedNode) {
    add(
      "node pin",
      "fail",
      `running ${deps.nodeVersion}, pinned ${expectedNode}; activate the pin (e.g. mise install)`,
    );
  } else {
    add("node pin", "ok", `node ${deps.nodeVersion} matches .nvmrc`);
  }

  const miseToml = deps.readText("mise.toml") ?? "";
  const miseNode = /node\s*=\s*"([^"]+)"/.exec(miseToml)?.[1] ?? "";
  if (!miseNode) {
    add("mise pin", "fail", "mise.toml has no node pin");
  } else if (expectedNode && miseNode !== expectedNode) {
    add(
      "mise pin",
      "fail",
      `mise.toml pins ${miseNode}, .nvmrc pins ${expectedNode}`,
    );
  } else {
    add("mise pin", "ok", `mise.toml pins node ${miseNode}`);
  }
  // mise may stall on its self-update check after printing its version;
  // a printed version line is enough evidence that the tool is present.
  const mise = await deps.run("mise", ["--version"], 5000);
  const miseVersion = short(mise.stdout);
  add(
    "mise",
    !mise.missing && (mise.code === 0 || miseVersion) ? "ok" : "warn",
    mise.missing
      ? "mise not on PATH; another version manager must honour the pin"
      : miseVersion || short(mise.stderr) || "present but unresponsive",
  );

  const expectedYarn = (() => {
    try {
      const pkgText = deps.readText("package.json");
      const pkg = pkgText ? JSON.parse(pkgText) : null;
      const pm =
        typeof pkg?.packageManager === "string" ? pkg.packageManager : "";
      return /^yarn@(.+)$/.exec(pm)?.[1] ?? "";
    } catch {
      return "";
    }
  })();
  if (!expectedYarn) {
    add("yarn pin", "fail", "package.json has no yarn packageManager pin");
  } else {
    const yarn = await deps.run("corepack", ["yarn", "--version"], 30000);
    if (yarn.missing) {
      add(
        "yarn pin",
        "fail",
        "corepack not found; Yarn is provided via Corepack",
      );
    } else if (yarn.timedOut) {
      add("yarn pin", "fail", "corepack yarn --version timed out");
    } else if (yarn.code !== 0) {
      add(
        "yarn pin",
        "fail",
        `corepack yarn failed: ${short(yarn.stderr || yarn.stdout)}`,
      );
    } else if (short(yarn.stdout) !== expectedYarn) {
      add(
        "yarn pin",
        "fail",
        `corepack yarn is ${short(yarn.stdout)}, pinned ${expectedYarn}`,
      );
    } else {
      add("yarn pin", "ok", `yarn ${expectedYarn} via Corepack`);
    }
  }

  const hasLock = deps.exists("yarn.lock");
  const hasModules = deps.exists("node_modules");
  if (!hasLock) {
    add(
      "dependencies",
      "fail",
      "yarn.lock missing; run: corepack yarn install",
    );
  } else if (!hasModules) {
    add(
      "dependencies",
      "fail",
      "node_modules missing; run: corepack yarn install",
    );
  } else {
    add("dependencies", "ok", "yarn.lock and node_modules present");
  }

  const localCliRel = "node_modules/.bin/evenhub";
  const localSimRel = "node_modules/.bin/evenhub-simulator";
  if (!deps.exists(localCliRel) || !deps.exists(localSimRel)) {
    add(
      "even tooling",
      "fail",
      "project-local evenhub CLI or simulator missing in node_modules/.bin; run: corepack yarn install",
    );
  } else {
    const cli = await deps.run(
      join(deps.rootPath, localCliRel),
      ["--version"],
      5000,
    );
    const sim = await deps.run(
      join(deps.rootPath, localSimRel),
      ["--version"],
      5000,
    );
    if (cli.code !== 0 || sim.code !== 0) {
      add(
        "even tooling",
        "fail",
        `local Even tooling failed (cli=${cli.code ?? "err"}, sim=${sim.code ?? "err"})`,
      );
    } else {
      add(
        "even tooling",
        "ok",
        `local evenhub ${short(cli.stdout)}, evenhub-simulator ${short(sim.stdout)}`,
      );
    }
  }
  const hw = inspectHardwareBaseline(deps.readText("docs/testing/TESTING.md"));
  add("hardware", hw.status, hw.detail);

  const failures = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  return { checks, failures, warnings };
}

/**
 * Parse M4 hardware matrix rows in docs/testing/TESTING.md without probing live BLE.
 * @param {string | null} testingMd
 * @returns {{ status: Status, detail: string }}
 */
export function inspectHardwareBaseline(testingMd) {
  if (!testingMd) {
    return {
      status: "deferred",
      detail: "physical G2/R1 device and Even app checks are M4, not run",
    };
  }
  const lines = testingMd.split(/\r?\n/);
  let inMatrix = false;
  let total = 0;
  let passed = 0;
  let failed = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inMatrix) {
      if (line.startsWith("## Hardware matrix")) {
        inMatrix = true;
      }
      continue;
    }
    if (line.startsWith("## ")) {
      break;
    }
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const caseCell = cells[0] ?? "";
    const statusCell = (cells[1] ?? "").toLowerCase();
    if (
      cells.length < 2 ||
      caseCell.length === 0 ||
      caseCell === "Case" ||
      /^-+$/.test(caseCell)
    ) {
      continue;
    }
    total += 1;
    if (statusCell === "pass") {
      passed += 1;
    } else if (statusCell === "fail") {
      failed += 1;
    }
  }

  if (total === 0) {
    return {
      status: "deferred",
      detail: "physical G2/R1 device and Even app checks are M4, not run",
    };
  }
  if (failed > 0) {
    return {
      status: "warn",
      detail: `M4 hardware matrix has failures (${passed}/${total} pass in docs/testing/TESTING.md)`,
    };
  }
  if (total >= 9 && passed === total) {
    return {
      status: "ok",
      detail: `M4 baseline recorded (${passed}/${total} pass in docs/testing/TESTING.md; CLI does not live-probe BLE)`,
    };
  }
  return {
    status: "deferred",
    detail: `M4 hardware matrix partially recorded (${passed}/${total} pass in docs/testing/TESTING.md)`,
  };
}

/**
 * @param {{ checks: Check[], failures: number, warnings: number }} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = report.checks.map(
    (c) => `[${c.status}] ${c.name}: ${c.detail}`,
  );
  const hwRecorded = report.checks.some(
    (c) => c.name === "hardware" && c.status === "ok",
  );
  const okSummary = hwRecorded
    ? `doctor: foundation ready (${report.warnings} warning(s)); M4 hardware baseline recorded`
    : `doctor: foundation ready (${report.warnings} warning(s)); physical device readiness deferred to M4`;
  lines.push(
    report.failures > 0
      ? `doctor: ${report.failures} failure(s), ${report.warnings} warning(s) - foundation NOT ready`
      : okSummary,
  );
  return lines.join("\n");
}

/** @returns {Deps} */
function realDeps() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  /** @param {string} rel */
  const readText = (rel) => {
    try {
      return readFileSync(join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const freeDiskBytes = (() => {
    try {
      const s = statfsSync(root);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  })();
  return {
    run: defaultRunner,
    readText,
    exists: (rel) => existsSync(join(root, rel)),
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    shell: process.env.SHELL ? basename(process.env.SHELL) : "",
    freeDiskBytes,
    rootPath: root,
  };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const report = await collectReport(realDeps());
  console.log(formatReport(report));
  process.exitCode = report.failures > 0 ? 1 : 0;
}
