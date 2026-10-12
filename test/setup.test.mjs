import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const documentPath of ["README.md", "docs/en/learning-from-scratch.md", "docs/ru/learning-from-scratch.md"]) {
test(`${documentPath} installs locked dependencies in a clean checkout before host setup`, async t => {
  const checkout = await mkdtemp(join(tmpdir(), "loom-clean-install-"));
  t.after(() => rm(checkout, { recursive: true, force: true }));
  for (const path of ["package.json", "package-lock.json", "README.md", "docs", "scripts", "src", "prompts", "shared", "adapters"]) {
    await cp(join(projectRoot, path), join(checkout, path), { recursive: true });
  }
  await assert.rejects(stat(join(checkout, "node_modules")), { code: "ENOENT" });
  const document = (await readFile(join(checkout, documentPath), "utf8")).replace(/\r\n|\r/g, "\n");
  const commands = document.match(/```bash\n([\s\S]*?)```/)[1].split("\n");
  const setupIndex = commands.findIndex(line => /^node scripts\/setup\.mjs(?:\s|$)/.test(line));
  assert.notEqual(setupIndex, -1, `${documentPath} must include adapter setup`);
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  for (const command of commands.slice(0, setupIndex).filter(line => /^npm ci(?:\s|$)/.test(line))) {
    const result = spawnSync(process.execPath, [npmCli, ...command.split(/\s+/).slice(1)], {
      cwd: checkout, encoding: "utf8", env: { ...process.env, npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false" },
    });
    assert.equal(result.status, 0, result.stderr);
  }
  // A nested fixture can otherwise accidentally resolve the parent checkout's dependencies.
  const requireFromCheckout = createRequire(join(checkout, "package.json"));
  for (const dependency of ["yaml", "ajv"]) {
    assert.ok(requireFromCheckout.resolve(dependency).startsWith(join(checkout, "node_modules")), `${documentPath}: ${dependency} was not installed before adapter setup`);
  }
  const hosts = documentPath === "README.md"
    ? [["codex", ".codex"], ["claude-code", ".claude"], ["opencode", ".opencode"], ["deepseek-harness", ".dsh"]]
    : [["codex", ".codex"]];
  for (const [host, hidden] of hosts) {
    const target = join(checkout, `learning-${host}`);
    const result = spawnSync(process.execPath, [join(checkout, "scripts/setup.mjs"), host, "--target", target, "--skip-mcp"], { cwd: checkout, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const installed = await readFile(join(target, hidden, "skills/concept-coach/references/coaching-reference.md"), "utf8");
    assert.equal(installed, await readFile(join(checkout, "adapters", host, hidden, "skills/concept-coach/references/coaching-reference.md"), "utf8"));
  }
});
}

test("Codex installer registers the explicit workspace", async () => {
  const target = await mkdtemp(join(tmpdir(), "concept-loom-codex-"));
  const setupUrl = new URL("../scripts/setup.mjs", import.meta.url).href;
  const source = `import childProcess from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
    childProcess.spawnSync = (command, args) => { if(command !== 'codex') throw new Error('unexpected command'); if(args[1] === 'get') return {status:1}; console.log(JSON.stringify({registration:args})); return {status:0}; };
    syncBuiltinESMExports(); process.argv = [process.execPath, 'setup.mjs', 'codex', '--target', process.argv[1]]; await import(${JSON.stringify(setupUrl)});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, target], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const registration = result.stdout.split("\n").find(line => line.startsWith('{"registration"'));
  assert.deepEqual(JSON.parse(registration).registration.slice(-2), ["--workspace", target]);
});

test("DeepSeek Harness installer creates a native skill and MCP patch", async () => {
  const target = await mkdtemp(join(tmpdir(), "concept-loom-dsh-"));
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "scripts", "setup.mjs"), "deepseek-harness", "--target", target],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const skill = await readFile(join(target, ".dsh", "skills", "concept-coach", "SKILL.md"), "utf8");
  const reference = await readFile(join(target, ".dsh", "skills", "concept-coach", "references", "coaching-reference.md"), "utf8");
  const patch = await readFile(join(target, ".dsh", "concept-loom.patch.yml"), "utf8");
  await stat(join(target, "AGENTS.md"));

  assert.match(skill, /name: concept-coach/);
  assert.match(reference, /# Connection-first coaching reference/);
  assert.match(patch, /name: '@deepseek-ai\/dsh-mcp-client'/);
  assert.match(patch, new RegExp(join(projectRoot, "src", "bridge.mjs").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(patch, /__SERVER_PATH__/);
  assert.match(patch, /--workspace/);
  assert.ok(patch.includes(target));
});

for (const [host, configPath] of [["claude-code", ".mcp.json"], ["opencode", "opencode.json"]]) {
  test(`${host} installer binds MCP to the target workspace`, async () => {
    const target = await mkdtemp(join(tmpdir(), "concept-loom-config-"));
    const result = spawnSync(process.execPath, [join(projectRoot, "scripts/setup.mjs"), host, "--target", target], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await readFile(join(target, configPath), "utf8"));
    const args = host === "claude-code" ? config.mcpServers["concept-loom"].args : config.mcp["concept-loom"].command;
    assert.deepEqual(args.slice(-2), ["--workspace", target]);
  });
}

test("DeepSeek Harness --skip-mcp installs only workspace guidance", async () => {
  const target = await mkdtemp(join(tmpdir(), "concept-loom-dsh-skip-"));
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "scripts", "setup.mjs"), "deepseek-harness", "--target", target, "--skip-mcp"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  await stat(join(target, ".dsh", "skills", "concept-coach", "SKILL.md"));
  await assert.rejects(stat(join(target, ".dsh", "concept-loom.patch.yml")), { code: "ENOENT" });
});
