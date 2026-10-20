import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function outside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

export async function resolveContainedPath(root, input, { create = false } = {}) {
  const canonicalRoot = await realpath(resolve(root));
  if (typeof input !== "string" || !input.trim() || isAbsolute(input)) {
    const error = new Error("path must be relative and inside the working directory");
    error.code = "OUTSIDE_WORKSPACE";
    throw error;
  }
  const candidate = resolve(canonicalRoot, input);
  if (outside(canonicalRoot, candidate)) {
    const error = new Error("path must be inside the working directory");
    error.code = "OUTSIDE_WORKSPACE";
    throw error;
  }
  let cursor = candidate;
  const missing = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        const error = new Error("symbolic links are not allowed inside the working directory");
        error.code = "OUTSIDE_WORKSPACE";
        throw error;
      }
      const actual = await realpath(cursor);
      if (outside(canonicalRoot, actual)) {
        const error = new Error("path must resolve inside the working directory");
        error.code = "OUTSIDE_WORKSPACE";
        throw error;
      }
      const resolved = resolve(actual, ...missing.reverse());
      if (create) await mkdir(dirname(resolved), { recursive: true });
      return resolved;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      cursor = parent;
    }
  }
}
