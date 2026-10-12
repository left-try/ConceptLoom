import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import Ajv from 'ajv/dist/2020.js';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schema = JSON.parse(await readFile(new URL('./frontmatter-0.2.schema.json', import.meta.url), 'utf8'));
const validateMetadata = new Ajv({ allErrors: true }).compile(schema);
const heading = /^(?:##|#) (system|developer|user|assistant)$/;
const normalized = source => source.replace(/\r\n|\r/g, '\n');

function yaml(text, label) {
  const document = parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: YAML ${document.errors.map(error => error.message).join('; ')}`);
  return document.toJS({ maxAliasCount: 100 });
}

function templateParts(content, declarations) {
  const parts = [];
  let literal = '';
  for (let index = 0; index < content.length;) {
    if (content.startsWith('\\{{', index)) { literal += '{{'; index += 3; continue; }
    if (content.startsWith('{%', index) || content.startsWith('{#', index)) throw new Error('unsupported template expression');
    if (!content.startsWith('{{', index)) { literal += content[index++]; continue; }
    const match = content.slice(index).match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/);
    if (!match) throw new Error('unsupported or unclosed template expression');
    const name = match[1];
    if (!Object.hasOwn(declarations, name)) throw new Error(`undeclared template input: ${name}`);
    parts.push(literal, { input: name });
    literal = '';
    index += match[0].length;
  }
  parts.push(literal);
  return parts;
}

/** OPF 0.2 metadata plus shared OPF message/input syntax; no provider settings. */
export function parsePrompt(source) {
  const text = normalized(source);
  const frontmatter = text.match(/^\uFEFF?---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatter) throw new Error('OPF requires opening and closing YAML frontmatter separators');
  const metadata = yaml(frontmatter[1], 'OPF frontmatter');
  if (!validateMetadata(metadata)) throw new Error(`invalid OPF 0.2 metadata: ${JSON.stringify(validateMetadata.errors)}`);
  const messages = [];
  let current;
  let fence;
  for (const original of text.slice(frontmatter[0].length).split('\n')) {
    const role = !fence && original.match(heading);
    if (role) {
      current = { role: role[1], lines: [] };
      messages.push(current);
      continue;
    }
    if (!current) {
      if (original.trim()) throw new Error('non-whitespace text before first message');
      continue;
    }
    let line = original;
    if (!fence && line.startsWith('\\') && heading.test(line.slice(1))) line = line.slice(1);
    const marker = original.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence && (marker[1][0] !== '`' || !marker[2].includes('`'))) fence = { char: marker[1][0], size: marker[1].length };
      else if (fence && marker[1][0] === fence.char && marker[1].length >= fence.size && !marker[2].trim()) fence = undefined;
    }
    current.lines.push(line);
  }
  if (!messages.length) throw new Error('OPF requires at least one message');
  const parsedMessages = messages.map(({ role, lines }) => {
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    const content = lines.join('\n');
    templateParts(content, metadata.inputs ?? {}); // Validate before accepting a source.
    return { role, content };
  });
  return { id: metadata.id, digest: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`, metadata, messages: parsedMessages };
}

/** Substitution occurs after role parsing; inserted strings are never reparsed. */
export function renderPrompt(prompt, inputs = {}) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('prompt inputs must be an object');
  const declarations = prompt.metadata.inputs ?? {};
  for (const name of Object.keys(inputs)) {
    if (!Object.hasOwn(declarations, name)) throw new Error(`undeclared input: ${name}`);
    if (typeof inputs[name] !== 'string') throw new Error(`input ${name} must be a string`);
  }
  for (const [name, declaration] of Object.entries(declarations)) {
    if (declaration.required !== false && !Object.hasOwn(inputs, name)) throw new Error(`missing required input: ${name}`);
  }
  return { id: prompt.id, digest: prompt.digest, messages: prompt.messages.map(({ role, content }) => ({
    role, content: templateParts(content, declarations).map(part => typeof part === 'string' ? part : inputs[part.input] ?? '').join(''),
  })) };
}

export async function readCatalog({ root = projectRoot } = {}) {
  const directory = resolve(root, 'prompts');
  const registry = yaml(await readFile(resolve(directory, 'registry.yaml'), 'utf8'), 'prompt registry');
  if (registry?.schema !== 'opf-registry/1' || !registry.prompts || typeof registry.prompts !== 'object' || Array.isArray(registry.prompts)) throw new Error('invalid opf-registry/1 catalog');
  const catalog = [];
  for (const [id, entry] of Object.entries(registry.prompts)) {
    if (entry?.renderer !== 'opf' || typeof entry.source !== 'string') throw new Error(`invalid registry entry: ${id}`);
    const path = resolve(directory, entry.source);
    const local = relative(directory, path);
    if (isAbsolute(entry.source) || local === '..' || local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(local)) throw new Error(`prompt source escapes catalog: ${id}`);
    const prompt = parsePrompt(await readFile(path, 'utf8'));
    if (prompt.id !== id) throw new Error(`registry ID ${id} differs from source ID ${prompt.id}`);
    catalog.push(prompt);
  }
  return catalog;
}

export async function loadPrompt(id, inputs = {}, options = {}) {
  const prompt = (await readCatalog(options)).find(prompt => prompt.id === id);
  if (!prompt) throw new Error(`unknown prompt: ${id}`);
  return renderPrompt(prompt, inputs);
}
