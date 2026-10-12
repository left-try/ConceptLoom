import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { resolveContainedPath } from "./storage/paths.mjs";
import { assertRecovery, commitTransaction, hashBytes, recoverTransactions, withWorkspaceLock } from "./storage/transactions.mjs";

const permittedKinds = new Set(["learner", "guide", "prompt", "response", "insight", "diagram"]);

function ensureInside(root, target) {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return target;
  throw new Error("notebook path must stay inside the working directory");
}

export function resolveNotebookPath(baseDirectory, requested = "learning-notes.md") {
  const root = resolve(baseDirectory);
  const destination = resolve(root, requested);
  return ensureInside(root, destination);
}

async function resolveNotebookFile(baseDirectory, requested) {
  const root = resolve(baseDirectory);
  const destination = resolveNotebookPath(root, requested);
  const path = relative(root, destination);
  return { destination: await resolveContainedPath(root, path), path };
}

function blockFor(kind, body, title) {
  const text = String(body ?? "").trim();
  if (!text) throw new Error("body must be non-empty");
  const labels = {
    learner: "LEARNER",
    guide: "GUIDE",
    prompt: "CHECKPOINT",
    response: "CHECKPOINT RESULT",
    insight: "KEY CONNECTION",
    diagram: "DIAGRAM",
  };
  const heading = title?.trim() || labels[kind];
  return `> [!${kind === "response" ? "success" : kind === "prompt" ? "question" : "note"}] ${heading}\n>\n${text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;
}

export async function beginNotebook(baseDirectory, input) {
  return withWorkspaceLock(baseDirectory, async () => {
    assertRecovery(await recoverTransactions(baseDirectory));
    const { destination, path } = await resolveNotebookFile(baseDirectory, input.path ?? "learning-notes.md");
    const heading = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Learning session";
    const preamble = `# ${heading}\n\n_Created by Concept Loom on ${new Date().toISOString()}_\n`;
    const existing = await readOptional(destination);
    if (input.replace === true || !existing?.toString("utf8").trim()) {
      await commitTransaction(baseDirectory, { checks: [{ path, expectedHash: existing === null ? null : hashBytes(existing) }], writes: [{ path, value: preamble, encoding: "utf8" }] });
    }
    return destination;
  });
}

export async function addNotebookEntry(baseDirectory, input) {
  return withWorkspaceLock(baseDirectory, async () => {
    assertRecovery(await recoverTransactions(baseDirectory));
    const { destination, path } = await resolveNotebookFile(baseDirectory, input.path ?? "learning-notes.md");
    const kind = String(input.kind ?? "");
    if (!permittedKinds.has(kind)) throw new Error(`kind must be one of: ${[...permittedKinds].join(", ")}`);
    const existing = await readOptional(destination);
    await commitTransaction(baseDirectory, { checks: [{ path, expectedHash: existing === null ? null : hashBytes(existing) }], writes: [{ path, value: `${existing?.toString("utf8") ?? ""}\n${blockFor(kind, input.body, input.title)}\n`, encoding: "utf8" }] });
    return destination;
  });
}

async function readOptional(path) {
  try { return await readFile(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
