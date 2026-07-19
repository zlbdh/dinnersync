import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const MAX_OUTPUT_CHARS = 65_536;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function startProductionServer(root, port) {
  const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let output = "";
  let spawnError;
  const append = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-MAX_OUTPUT_CHARS);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => { spawnError = error; });
  return { child, error: () => spawnError, output: () => output };
}

export async function waitForOwnedServer(server, baseUrl, options = {}) {
  const attempts = options.attempts ?? 120;
  const delayImpl = options.delayImpl ?? delay;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (server.error()) {
      throw new Error(`Production server could not start.\n${server.error().message}`);
    }
    if (server.child.exitCode !== null) {
      throw new Error(`Production server exited early.\n${server.output()}`);
    }
    // 2026-07-19 by Codex — a 200 can belong to a stale process, so trust our child's Ready signal first.
    if (/\bReady in\b/iu.test(server.output())) {
      try {
        const response = await fetchImpl(baseUrl, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok && server.child.exitCode === null) return;
      } catch {
        // Keep polling while the owned server finishes opening its listener.
      }
    }
    await delayImpl(500);
  }
  throw new Error(`Production server did not become ready.\n${server.output()}`);
}

export function stopProductionServer(server) {
  if (!server.child.pid || server.child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    server.child.kill("SIGTERM");
  }
}
