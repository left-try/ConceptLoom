import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const promptsDirectory = join(root, "prompts");
function digest(text) { return createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex"); }

function parsePrompt(source, id) {
  const normalized = source.replaceAll("\r\n", "\n");
  const split = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!split) throw new Error(`prompt '${id}' is missing frontmatter`);
  const metadata = {};
  for (const line of split[1].split("\n")) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (match) metadata[match[1]] = match[2].trim();
  }
  const messages = [];
  const body = normalized.slice(split[0].length);
  const marker = /^## (system|user|assistant)\n/gm;
  let current; let match;
  while ((match = marker.exec(body))) {
    if (current) current.content = body.slice(current.start, match.index).trim();
    current = { role: match[1], start: marker.lastIndex };
    messages.push(current);
  }
  if (current) current.content = body.slice(current.start).trim();
  if (!messages.length) throw new Error(`prompt '${id}' has no messages`);
  for (const message of messages) delete message.start;
  return { metadata, messages };
}

function substitute(messages, inputs) {
  const allowed = new Set(Object.keys(inputs));
  return messages.map((message) => ({
    role: message.role,
    content: message.content.replace(/\{\{([a-zA-Z][\w.-]*)\}\}/g, (placeholder, key) => {
      if (!allowed.has(key)) throw new Error(`missing prompt input '${key}'`);
      const value = inputs[key];
      if (typeof value !== "string" && typeof value !== "number") throw new Error(`prompt input '${key}' must be text`);
      return String(value);
    }),
  }));
}

export async function loadPrompt(id, inputs = {}) {
  if (!/^[a-z][a-z-]{0,63}$/.test(id)) throw new Error("prompt id is invalid");
  const source = await readFile(join(promptsDirectory, `${id}.opf.md`), "utf8");
  const parsed = parsePrompt(source, id);
  if (parsed.metadata.id !== id || parsed.metadata.format !== "opf/0.2") throw new Error(`prompt '${id}' has incompatible metadata`);
  return { id, digest: digest(source), messages: substitute(parsed.messages, inputs) };
}

export async function buildReferences({ check = false } = {}) {
  const reference = await readFile(join(root, "shared", "coaching-reference.md"), "utf8");
  const destinations = [
    "adapters/codex/.codex/skills/concept-coach/references/coaching-reference.md",
    "adapters/claude-code/.claude/skills/concept-coach/references/coaching-reference.md",
    "adapters/opencode/.opencode/skills/concept-coach/references/coaching-reference.md",
    "adapters/deepseek-harness/.dsh/skills/concept-coach/references/coaching-reference.md",
  ];
  const changedPaths = [];
  for (const destination of destinations) {
    let current = null;
    try { current = await readFile(join(root, destination), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (current !== reference) {
      changedPaths.push(destination);
      if (!check) await writeFile(join(root, destination), reference, "utf8");
    }
  }
  if (check && changedPaths.length) throw new Error(`generated references are out of date: ${changedPaths.join(", ")}`);
  return { changedPaths };
}
