// CLI entry point for `corepack yarn test:sim` (M3).
import { relative } from "node:path";

import { parsePortEnv, runSimulatorSuite } from "./sim-harness.mjs";

const devPort = parsePortEnv(
  "SIM_TEST_DEV_PORT",
  process.env.SIM_TEST_DEV_PORT,
);
const autoPort = parsePortEnv(
  "SIM_TEST_AUTO_PORT",
  process.env.SIM_TEST_AUTO_PORT,
);

const summary = await runSimulatorSuite({
  ...(devPort !== undefined ? { devPort } : {}),
  ...(autoPort !== undefined ? { autoPort } : {}),
});

for (const step of summary.steps) {
  const tag = step.status === "passed" ? "[ok]" : "[fail]";
  console.log(`${tag} ${step.step}: ${step.detail}`);
}

for (const proc of summary.cleanup) {
  if (proc.pid !== null) {
    console.log(
      `[cleanup] ${proc.name} (pid=${proc.pid}) exited code=${proc.exitCode ?? "null"} signal=${proc.signalCode ?? "none"}${proc.forcedKill ? " (SIGKILL fallback)" : ""}`,
    );
  }
}

const relArtifacts = relative(process.cwd(), summary.artifactDir) || ".";
if (summary.status === "passed") {
  console.log(
    `test:sim PASSED in ${summary.durationMs}ms (artifacts: ${relArtifacts})`,
  );
  process.exitCode = 0;
} else {
  console.error(
    `test:sim FAILED at step "${summary.failedStep ?? "unknown"}": ${summary.error ?? "unknown error"}`,
  );
  console.error(`Failure evidence written to: ${relArtifacts}`);
  process.exitCode = 1;
}
