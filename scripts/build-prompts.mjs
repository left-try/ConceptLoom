#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot, readCatalog } from '../src/prompts/loader.mjs';

const hosts = { codex: '.codex', 'claude-code': '.claude', opencode: '.opencode', 'deepseek-harness': '.dsh' };

export async function buildReferences({ check = false, root = projectRoot } = {}) {
  const catalog = await readCatalog({ root });
  const guidance = catalog.find(prompt => prompt.id === 'diagnose')?.metadata.extensions?.['com.conceptloom.hosts'];
  if (!guidance || Object.keys(hosts).some(host => typeof guidance[host] !== 'string')) throw new Error('catalog is missing host tool guidance');
  if (Object.keys(hosts).some(host => guidance[host].includes('{{'))) throw new Error('host guidance has unresolved template inputs');
  const sections = catalog.map(prompt => {
    const instructions = prompt.messages.filter(message => ['system', 'developer'].includes(message.role)).map(message => message.content).join('\n\n');
    if (instructions.includes('{{')) throw new Error(`static reference has unresolved template inputs: ${prompt.id}`);
    return `## ${prompt.id}\n\n<!-- ${prompt.digest} -->\n\n${instructions}`;
  });
  const common = `# Connection-first coaching reference\n\n<!-- Generated from prompts/registry.yaml by scripts/build-prompts.mjs. Edit the catalog sources and rebuild. -->\n\nThese are coaching instructions read by the host within its existing permissions. The host remains responsible for tool availability and execution.\n\n${sections.join('\n\n')}\n`;
  const outputs = [['shared/coaching-reference.md', common]];
  for (const [host, hidden] of Object.entries(hosts)) outputs.push([
    `adapters/${host}/${hidden}/skills/concept-coach/references/coaching-reference.md`,
    `${common}\n## Host tools: ${host}\n\n${guidance[host]}\n`,
  ]);
  const changedPaths = [];
  for (const [path, expected] of outputs) {
    let actual;
    try { actual = await readFile(resolve(root, path), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual?.replace(/\r\n|\r/g, '\n') !== expected) changedPaths.push(path);
  }
  if (check && changedPaths.length) throw new Error(`generated reference drift: ${changedPaths.join(', ')}`);
  if (!check) for (const [path, expected] of outputs) {
    if (!changedPaths.includes(path)) continue;
    const destination = resolve(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, expected, 'utf8');
  }
  return { changedPaths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await buildReferences({ check: process.argv.includes('--check') });
    process.stdout.write(`${process.argv.includes('--check') ? 'Checked' : 'Built'} prompt references (${result.changedPaths.length} changed).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
