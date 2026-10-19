import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makePracticeWorkspace(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "conceptloom-practice-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  return root;
}

export const publicSpec = {
  title: "Repair the transaction sequence",
  instructions: "Choose a safe ordering and explain the invariant.",
  prompt: "Two workers update the same revision.",
};

export const privateCriteria = {
  expected: "private-answer-marker-7f3a",
  rubric: [{ id: "atomicity", description: "private-rubric-marker-b19c" }],
};

export async function readWorkspaceFiles(root) {
  const { readdir, readFile } = await import("node:fs/promises");
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push({ path, text: await readFile(path, "utf8") });
    }
  }
  await visit(root);
  return files;
}
