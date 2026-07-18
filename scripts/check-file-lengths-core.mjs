import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

export const maximumLines = 300;

export const checkedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

export const ignoredDirectoryNames = new Set([
  "node_modules",
  ".next",
  ".git",
  ".worktrees",
  "build",
  "dist",
  "out",
  "coverage",
  "playwright-report",
  "test-results",
  ".turbo",
]);

export const ignoredFileNames = new Set(["next-env.d.ts"]);

export function countLines(source) {
  if (source.length === 0) {
    return 0;
  }

  const lines = source.split(/\r\n|\r|\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

export function shouldCheckFile(fileName) {
  return (
    !ignoredFileNames.has(fileName) && checkedExtensions.has(extname(fileName))
  );
}

export function findOversizedFiles(
  files,
  { allowlist = new Set(), lineLimit = maximumLines } = {},
) {
  return files.flatMap((file) => {
    if (allowlist.has(file.relativePath)) {
      return [];
    }

    const lineCount = countLines(file.source);
    return lineCount > lineLimit ? [{ ...file, lineCount }] : [];
  });
}

async function collectFiles(projectRoot, directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return ignoredDirectoryNames.has(entry.name)
          ? []
          : collectFiles(projectRoot, entryPath);
      }

      if (!entry.isFile() || !shouldCheckFile(entry.name)) {
        return [];
      }

      return [
        {
          relativePath: relative(projectRoot, entryPath).split(sep).join("/"),
          source: await readFile(entryPath, "utf8"),
        },
      ];
    }),
  );

  return files.flat();
}

export async function checkProjectFileLengths(
  projectRoot,
  { allowlist = new Set(), lineLimit = maximumLines } = {},
) {
  const files = (await collectFiles(projectRoot, projectRoot)).sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  return {
    files,
    maximumLines: lineLimit,
    oversizedFiles: findOversizedFiles(files, { allowlist, lineLimit }),
  };
}
