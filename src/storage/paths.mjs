import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, win32 } from "node:path";

function outside() {
  return Object.assign(new Error("OUTSIDE_WORKSPACE: path must stay inside the working directory"), { code: "OUTSIDE_WORKSPACE" });
}

function contained(root, target) {
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw outside();
}

// Walk existing components with realpath: lexical containment alone misses junctions.
export async function resolveContainedPath(root, requested, { create = false } = {}) {
  if (typeof requested !== "string" || !requested || requested.includes("\0") || isAbsolute(requested) || win32.isAbsolute(requested) || /^[a-z]:/i.test(requested)) throw outside();
  const parts = requested.split(/[\\/]/);
  if (parts.includes("..") || parts.some(part => part.includes(":"))) throw outside();
  const base = resolve(root);
  const canonicalRoot = await realpath(base);
  let current = canonicalRoot;
  const components = parts.filter(part => part && part !== ".");
  for (let index = 0; index < components.length; index++) {
    current = join(current, components[index]);
    contained(canonicalRoot, current);
    try {
      await lstat(current);
      current = await realpath(current);
      contained(canonicalRoot, current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (create && index < components.length - 1) {
        await mkdir(current, { recursive: false }).catch(error => { if (error.code !== "EEXIST") throw error; });
        current = await realpath(current);
        contained(canonicalRoot, current);
      }
    }
  }
  return current;
}
