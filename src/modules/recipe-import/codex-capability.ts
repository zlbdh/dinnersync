import {
  mkdir as nodeMkdir,
  mkdtemp as nodeMkdtemp,
  readFile as nodeReadFile,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodexExecutable } from "./codex-executable";
import { buildCodexSandboxArguments } from "./codex-permissions";
import { createStatusCommandRunner } from "./codex-status-process";

export type LocalAiCapabilityResult =
  | { ok: true; value: { sandboxAvailable: true } }
  | {
      ok: false;
      error: {
        code: "SANDBOX_UNAVAILABLE";
        message: string;
      };
    };

type RunCapabilityCommand = (
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => Promise<{ exitCode: number | null }>;

type CapabilityDependencies = {
  executable?: string;
  execPath?: string;
  tempRoot?: string;
  outsideCanaryPath?: string;
  mkdtemp?: (prefix: string) => Promise<string>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  readFile?: (path: string, encoding: "utf8") => Promise<string>;
  writeFile?: (path: string, data: string, encoding: "utf8") => Promise<unknown>;
  removeDirectory?: (
    path: string,
    options: { recursive: true; force: true },
  ) => Promise<unknown>;
  runCommand?: RunCapabilityCommand;
};

const CANARY_TEXT = "DinnerSync harmless sandbox canary v1";
const OUTSIDE_CANARY_TEXT = "DinnerSync harmless outside sandbox canary v1\n";
const CANARY_SCRIPT = [
  'const fs=require("node:fs");',
  "const inside=process.argv[1],outside=process.argv[2],expected=process.argv[3];",
  "try{if(fs.readFileSync(inside,'utf8')!==expected)process.exit(40)}catch{process.exit(41)}",
  "try{fs.readFileSync(outside,'utf8');process.exit(42)}catch(error){",
  "process.exit(error&&['EACCES','EPERM','ENOENT'].includes(error.code)?0:43)}",
].join("");

export function createLocalAiCapabilityChecker(
  dependencies: CapabilityDependencies = {},
) {
  let cached: Promise<LocalAiCapabilityResult> | undefined;
  return () => {
    cached ??= runCapabilityProbe(dependencies);
    return cached;
  };
}

export const checkLocalAiCapability = createLocalAiCapabilityChecker();

async function runCapabilityProbe(
  dependencies: CapabilityDependencies,
): Promise<LocalAiCapabilityResult> {
  const mkdtemp = dependencies.mkdtemp ?? nodeMkdtemp;
  const mkdir = dependencies.mkdir ?? nodeMkdir;
  const writeFile = dependencies.writeFile ?? nodeWriteFile;
  const readFile = dependencies.readFile ?? nodeReadFile;
  const removeDirectory = dependencies.removeDirectory ?? nodeRm;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  let baseDirectory: string | undefined;
  let passed = false;
  try {
    const executable = dependencies.executable ?? resolveCodexExecutable();
    baseDirectory = await mkdtemp(join(dependencies.tempRoot ?? tmpdir(), "dinnersync-gate-"));
    const workspace = join(baseDirectory, "workspace");
    const codexHome = join(baseDirectory, "codex-home");
    const insideCanary = join(workspace, "inside-canary.txt");
    const outsideCanary = dependencies.outsideCanaryPath
      ?? join(
        /*turbopackIgnore: true*/ process.cwd(), "public", "dinnersync-sandbox-canary.txt",
      );
    const outsideCanaryText = await readFile(
      /*turbopackIgnore: true*/ outsideCanary,
      "utf8",
    );
    if (outsideCanaryText.replaceAll("\r\n", "\n") !== OUTSIDE_CANARY_TEXT) {
      throw new Error("CANARY_MISMATCH");
    }
    await mkdir(workspace, { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await writeFile(insideCanary, CANARY_TEXT, "utf8");
    const args = buildCodexSandboxArguments(workspace, [
      dependencies.execPath ?? process.execPath,
      "-e",
      CANARY_SCRIPT,
      insideCanary,
      outsideCanary,
      CANARY_TEXT,
    ]);
    const result = await runCommand(executable, args, {
      ...process.env,
      CODEX_HOME: codexHome,
    });
    if (result.exitCode === 0) {
      const textAfterProbe = await readFile(
        /*turbopackIgnore: true*/ outsideCanary,
        "utf8",
      );
      passed = textAfterProbe.replaceAll("\r\n", "\n") === OUTSIDE_CANARY_TEXT;
    }
  } catch {
    passed = false;
  }
  if (baseDirectory) {
    try {
      await removeDirectory(baseDirectory, { recursive: true, force: true });
    } catch {
      passed = false;
    }
  }
  return passed
    ? { ok: true, value: { sandboxAvailable: true } }
    : capabilityFailure();
}

async function defaultRunCommand(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) {
  const run = createStatusCommandRunner({
    environment,
    timeoutMs: 10_000,
    outputLimitBytes: 16_384,
    forceConfirmationMs: 500,
  });
  return run(executable, args);
}

function capabilityFailure(): LocalAiCapabilityResult {
  return {
    ok: false,
    error: {
      code: "SANDBOX_UNAVAILABLE",
      message: "The local Codex sandbox did not prove the required isolation.",
    },
  };
}
