// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { readCodexResult } from "../codex-output";

class FileHandleDouble {
  readonly close = vi.fn().mockResolvedValue(undefined);
  readonly read = vi.fn(async (buffer: Buffer, offset: number, length: number) => {
    const source = this.chunks.shift();
    if (!source) return { bytesRead: 0 };
    const bytesRead = Math.min(source.length, length);
    source.copy(buffer, offset, 0, bytesRead);
    if (bytesRead < source.length) this.chunks.unshift(source.subarray(bytesRead));
    return { bytesRead };
  });
  readonly stat = vi.fn(async () => {
    const size = this.sizes.length > 1 ? this.sizes.shift()! : this.sizes[0];
    return { size };
  });

  constructor(
    readonly chunks: Buffer[],
    readonly sizes: number[],
  ) {}
}

function reader(handle: FileHandleDouble, maxBytes: number) {
  return readCodexResult("result.json", maxBytes, {
    openFile: vi.fn().mockResolvedValue(handle),
  });
}

describe("bounded Codex result reader", () => {
  it("loops across short reads and verifies the stable final size", async () => {
    const text = '{"ok":true}';
    const bytes = Buffer.from(text);
    const handle = new FileHandleDouble(
      [bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)],
      [bytes.length, bytes.length],
    );

    await expect(reader(handle, bytes.length)).resolves.toBe(text);
    expect(handle.read).toHaveBeenCalledTimes(4);
    expect(handle.stat).toHaveBeenCalledTimes(2);
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("distinguishes an empty file from an oversized file", async () => {
    await expect(reader(new FileHandleDouble([], [0]), 8)).rejects.toMatchObject({
      code: "CODEX_NO_OUTPUT",
    });
    await expect(reader(new FileHandleDouble([], [9]), 8)).rejects.toMatchObject({
      code: "CODEX_OUTPUT_TOO_LARGE",
    });
  });

  it("accepts exactly the byte limit and rejects one additional byte", async () => {
    const exact = Buffer.from("12345678");
    await expect(reader(
      new FileHandleDouble([exact], [exact.length, exact.length]),
      exact.length,
    )).resolves.toBe("12345678");

    const grown = Buffer.from("123456789");
    await expect(reader(
      new FileHandleDouble([grown], [8, grown.length]),
      8,
    )).rejects.toMatchObject({ code: "CODEX_OUTPUT_TOO_LARGE" });
  });

  it("counts UTF-8 bytes rather than JavaScript characters", async () => {
    const bytes = Buffer.from("你好");
    const handle = new FileHandleDouble([bytes], [bytes.length, bytes.length]);

    await expect(reader(handle, 6)).resolves.toBe("你好");
  });

  it("rejects a file whose size changes during the read", async () => {
    const bytes = Buffer.from("abcd");
    const handle = new FileHandleDouble([bytes], [4, 5]);

    await expect(reader(handle, 8)).rejects.toMatchObject({
      code: "CODEX_INVALID_OUTPUT",
    });
  });
});
