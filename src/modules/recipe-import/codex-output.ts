import { open as nodeOpen } from "node:fs/promises";

import { CodexRunnerError } from "./codex-types";

export type ResultFileHandle = {
  stat: () => Promise<{ size: number }>;
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
  close: () => Promise<void>;
};

export type ResultReaderDependencies = {
  openFile?: (path: string) => Promise<ResultFileHandle>;
};

const READ_CHUNK_BYTES = 65_536;

export async function readCodexResult(
  path: string,
  maxBytes: number,
  dependencies: ResultReaderDependencies = {},
) {
  const openFile = dependencies.openFile ?? (nodeOpen as unknown as (path: string) =>
    Promise<ResultFileHandle>);
  let handle: ResultFileHandle;
  try {
    handle = await openFile(path);
  } catch {
    throw new CodexRunnerError("CODEX_NO_OUTPUT", "Codex produced no result.");
  }

  let primaryError: CodexRunnerError | undefined;
  let result: string | undefined;
  try {
    result = await readStableFile(handle, maxBytes);
  } catch (error) {
    primaryError = safeResultError(error);
  }
  try {
    await handle.close();
  } catch {
    if (primaryError) primaryError.addDiagnostic("RESULT_HANDLE_CLOSE_FAILED");
    else {
      primaryError = new CodexRunnerError(
        "CODEX_INVALID_OUTPUT",
        "The Codex result file could not be closed safely.",
      );
    }
  }
  if (primaryError) throw primaryError;
  return result!;
}

async function readStableFile(handle: ResultFileHandle, maxBytes: number) {
  const initial = await safeStat(handle);
  assertSize(initial.size, maxBytes);
  if (initial.size === 0) {
    throw new CodexRunnerError("CODEX_NO_OUTPUT", "Codex produced no result.");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const remaining = maxBytes + 1 - total;
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
    const read = await handle.read(buffer, 0, buffer.length, total);
    if (!Number.isInteger(read.bytesRead) || read.bytesRead < 0 || read.bytesRead > buffer.length) {
      throw invalidResult();
    }
    if (read.bytesRead === 0) break;
    total += read.bytesRead;
    if (total > maxBytes) throw tooLarge();
    chunks.push(buffer.subarray(0, read.bytesRead));
  }

  const final = await safeStat(handle);
  if (final.size > maxBytes) throw tooLarge();
  if (final.size !== initial.size || final.size !== total) throw invalidResult();
  const text = Buffer.concat(chunks, total).toString("utf8").trim();
  if (!text) throw new CodexRunnerError("CODEX_NO_OUTPUT", "Codex produced no result.");
  return text;
}

async function safeStat(handle: ResultFileHandle) {
  try {
    return await handle.stat();
  } catch {
    throw invalidResult();
  }
}

function assertSize(size: number, maxBytes: number) {
  if (!Number.isSafeInteger(size) || size < 0) throw invalidResult();
  if (size > maxBytes) throw tooLarge();
}

function safeResultError(error: unknown) {
  return error instanceof CodexRunnerError ? error : invalidResult();
}

function invalidResult() {
  return new CodexRunnerError(
    "CODEX_INVALID_OUTPUT",
    "The Codex result file changed or could not be read safely.",
  );
}

function tooLarge() {
  return new CodexRunnerError(
    "CODEX_OUTPUT_TOO_LARGE",
    "Codex produced more output than allowed.",
  );
}
