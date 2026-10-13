import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeWorkspace(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "conceptloom-knowledge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  return root;
}

export const note = (type, title, body = "Body text.", extra = "") =>
  `---\ntype: ${type}\ntitle: ${JSON.stringify(title)}\n${extra}---\n${body}\n`;

export const rootIndex = `---\nokf_version: "0.2"\n---\n# Knowledge\n`;
