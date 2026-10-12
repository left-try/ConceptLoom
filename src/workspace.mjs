import { resolve } from "node:path";

export function resolveWorkspace({ cwd = process.cwd(), argv = process.argv.slice(2), env = process.env } = {}) {
  const index = argv.indexOf("--workspace");
  if (index >= 0 && (!argv[index + 1] || argv[index + 1].startsWith("--"))) {
    throw new Error("--workspace requires a path");
  }
  return resolve(cwd, index >= 0 ? argv[index + 1] : env.CONCEPT_LOOM_WORKSPACE || cwd);
}
