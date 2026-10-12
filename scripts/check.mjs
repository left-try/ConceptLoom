import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await checkDirectory(path);
    else if (/\.(mjs|cjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
      if (result.status !== 0 || result.error) {
        process.stderr.write(result.stderr || String(result.error));
        process.exitCode = 1;
      }
    }
  }
}
for (const directory of ["src", "scripts", "test"]) await checkDirectory(join(root, directory));
