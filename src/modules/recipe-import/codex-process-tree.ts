import { spawn as nodeSpawn } from "node:child_process";

export type ForceKillTree = (pid: number) => Promise<void>;

type TreeKillerChild = {
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once: (event: string, listener: (...args: never[]) => void) => TreeKillerChild;
  removeListener: (event: string, listener: (...args: never[]) => void) => TreeKillerChild;
};
type SpawnTreeKiller = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => TreeKillerChild;
type ForceKillDependencies = {
  platform?: NodeJS.Platform;
  processKill?: (pid: number, signal: NodeJS.Signals) => boolean | void;
  spawnTree?: SpawnTreeKiller;
  taskkillTimeoutMs?: number;
};

export function createForceKillTree(dependencies: ForceKillDependencies = {}): ForceKillTree {
  const platform = dependencies.platform ?? process.platform;
  const processKill = dependencies.processKill ?? process.kill.bind(process);
  const spawnTree = dependencies.spawnTree ?? (nodeSpawn as unknown as SpawnTreeKiller);
  const timeoutMs = dependencies.taskkillTimeoutMs ?? 2_000;
  return async (pid: number) => {
    assertTargetPid(pid);
    if (platform !== "win32") {
      processKill(-pid, "SIGKILL");
      return;
    }
    await runTaskkill(spawnTree, pid, timeoutMs);
  };
}

async function runTaskkill(spawnTree: SpawnTreeKiller, pid: number, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    let child: TreeKillerChild;
    try {
      child = spawnTree("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      reject(new Error("TASKKILL_START_FAILED"));
      return;
    }
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("error", onError as never);
      child.removeListener("close", onClose as never);
      if (error) reject(error);
      else resolve();
    };
    const onError = () => finish(new Error("TASKKILL_FAILED"));
    const onClose = (code: number | null) => finish(
      code === 0 ? undefined : new Error("TASKKILL_FAILED"),
    );
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* bounded below */ }
      finish(new Error("TASKKILL_TIMEOUT"));
    }, timeoutMs);
    child.once("error", onError as never);
    child.once("close", onClose as never);
  });
}

function assertTargetPid(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("INVALID_TARGET_PID");
}
