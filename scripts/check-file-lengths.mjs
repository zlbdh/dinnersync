import { checkProjectFileLengths } from "./check-file-lengths-core.mjs";

const projectRoot = process.cwd();
const allowlist = new Set([]);
const result = await checkProjectFileLengths(projectRoot, { allowlist });

if (result.files.length === 0) {
  console.error("No code or configuration files matched the file length check.");
  process.exitCode = 1;
} else if (result.oversizedFiles.length > 0) {
  console.error(`Files exceed the ${result.maximumLines}-line limit:`);
  console.error(
    result.oversizedFiles
      .map(({ relativePath, lineCount }) => `${relativePath}: ${lineCount} lines`)
      .join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    `File length check passed (${result.files.length} files, maximum ${result.maximumLines} lines).`,
  );
}
