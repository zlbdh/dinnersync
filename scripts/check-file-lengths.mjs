import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const projectRoot = process.cwd();
const sourceRoots = ["src", "scripts", "tests"];
const checkedExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const allowlist = new Set([]);
const maximumLines = 300;

async function collectFiles(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
    }),
  );

  return files.flat();
}

function countLines(source) {
  if (source.length === 0) {
    return 0;
  }

  const lines = source.split(/\r\n|\r|\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

const files = (
  await Promise.all(sourceRoots.map((root) => collectFiles(join(projectRoot, root))))
)
  .flat()
  .filter((file) => checkedExtensions.has(extname(file)))
  .sort();

const oversizedFiles = [];

for (const file of files) {
  const relativePath = relative(projectRoot, file).split(sep).join("/");

  if (allowlist.has(relativePath)) {
    continue;
  }

  const lineCount = countLines(await readFile(file, "utf8"));

  if (lineCount > maximumLines) {
    oversizedFiles.push(`${relativePath}: ${lineCount} lines`);
  }
}

if (oversizedFiles.length > 0) {
  console.error(`Files exceed the ${maximumLines}-line limit:`);
  console.error(oversizedFiles.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `File length check passed (${files.length} files, maximum ${maximumLines} lines).`,
  );
}
