import { isAbsolute, resolve } from "node:path";

export function resolveWorkspace({ cwd = process.cwd(), argv = process.argv, env = process.env } = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const flagIndex = args.indexOf("--workspace");
  const fromFlag = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  if (flagIndex >= 0 && (!fromFlag || fromFlag.startsWith("--"))) {
    throw new Error("--workspace requires a path");
  }
  const selected = fromFlag ?? env.CONCEPT_LOOM_WORKSPACE ?? cwd;
  return isAbsolute(selected) ? resolve(selected) : resolve(cwd, selected);
}
