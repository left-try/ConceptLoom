<p align="center">
  <img src="assets/concept-loom-cover.svg" alt="Concept Loom learning workflow: Locate, Weave, Build, Check, and Save" width="100%">
</p>

# Concept Loom

**A portable AI learning workflow for Codex, Claude Code, OpenCode, and DeepSeek Harness.**

Version 1.1.0 · MIT licensed · Node.js 20+

[English](#concept-loom) · [Русский](docs/ru/README.md)

Concept Loom turns a coding agent into a structured learning partner. Instead of immediately producing a long explanation, it helps you define a useful goal, finds the edge of your current understanding, proposes a short dependency path, and teaches one connection at a time.

```text
goal → knowledge frontier → learning map → one connection → check → transfer
```

It works with topics you explore from scratch and with your own books, courses, notes, code, and transcripts.

## Why use it?

- Learn toward a practical outcome instead of surveying an entire field.
- Expose gaps and misconceptions before building on them.
- Check understanding with concealed-answer checkpoints.
- Measure recognition, recall, application, and transfer separately.
- Revisit due concepts through spaced retrieval across sessions.
- Keep concise Markdown learning notes between sessions.
- Use the same workflow in Codex, Claude Code, OpenCode, and DeepSeek Harness.
- Show compact text or Mermaid diagrams directly in the conversation.

## Documentation

| Guide | Use it when… |
|---|---|
| [How Concept Loom works](docs/en/how-it-works.md) | You want to understand the method and architecture. |
| [Learning from scratch](docs/en/learning-from-scratch.md) | You are starting without a book or course. |
| [Learning with source materials](docs/en/learning-with-source-materials.md) | You have PDFs, EPUBs, notes, videos, code, or course files. |

Russian documentation starts at [docs/ru/README.md](docs/ru/README.md).

## Quick start with Codex

Requirements: Node.js 20+, npm and Codex CLI. Run these commands from the cloned Concept Loom repository:

```bash
# Install the locked dependencies before running setup
npm ci --ignore-scripts

# Install the adapter and register its MCP server automatically
node scripts/setup.mjs codex --target /path/to/learning-workspace

# Start learning
cd /path/to/learning-workspace
codex
```

Use `--skip-mcp` only if you want to install the workspace files without changing the global Codex MCP configuration.

After updating Concept Loom, run `npm ci --ignore-scripts` in its repository, then refresh an already installed skill with `node scripts/setup.mjs codex --target /path/to/learning-workspace --refresh`.

Then ask:

```text
Use $concept-coach. I want to understand database transactions well enough
to choose the right isolation level for a small web application.
```

For a multi-session course, ask directly:

```text
Use $concept-coach. Build me a course on database transactions. I can study
30 minutes on weekdays, and I want to choose safe isolation levels at work.
```

You can also ask to learn from your own materials, resume a lesson, or review a topic. No special command syntax is needed. Course intake and diagnosis proceed one question at a time. After roadmap approval, the coach proposes a concrete schedule for separate approval; activation still depends on host confirmation.

## Other clients

Install dependencies with `npm ci --ignore-scripts` in the Concept Loom repository before running any adapter setup:

```bash
node scripts/setup.mjs claude-code --target /path/to/learning-workspace
node scripts/setup.mjs opencode --target /path/to/learning-workspace
node scripts/setup.mjs deepseek-harness --target /path/to/learning-workspace
```

DeepSeek Harness support uses its native project skill directory and an MCP patch. Start it from the learning workspace with:

```bash
npx @deepseek-ai/dsh --profile web --patch .dsh/concept-loom.patch.yml
```

DeepSeek Harness is currently a developer preview and may introduce breaking configuration changes. Use `--skip-mcp` if you only want the `.dsh/skills/concept-coach` skill and will connect the MCP server through your own Harness profile.

The installer refuses to overwrite existing configuration. Merge a generated Concept Loom file manually when guidance or MCP configuration already exists.

Concept Loom uses `yaml` and `ajv` to parse and validate its OPF prompt catalog and check generated references during setup. Their versions are recorded in the lockfile. Small structures are displayed as monospace text diagrams; larger relationship maps are returned as Mermaid blocks that remain readable in the terminal and render in compatible Markdown viewers.

## Foundation persistence and local evaluation

Learning state uses schema v3 with revision checks and a workspace transaction journal. Patch updates preserve omitted fields; supplied arrays and evidence objects replace their corresponding values. Snapshot updates require the complete core state. Migration from v1/v2 preserves a backup. Assessment commits the attempt receipt, learner evidence, resume point and token claim together. Reusing the same `attemptId` with the same input returns the committed result; different input conflicts.

Public factual `practice-assessed` events and registry `state-restored` events append to `.concept-loom/evaluation/events.jsonl`, serialized by the workspace lock and deduplicated by `eventId`. The versioned CaptureEvent contract requires `eventId,eventType,timestamp,host,input,output`; optional identifiers use `runId,parentId,courseUid,lessonUid,nodeUid`. Capture uses a reviewed allowlist: no expected answers, rationale, hidden reasoning, grading criteria, private assessment material or arbitrary learner text. Empty factual input/output objects are valid. Hosts may supply their known identity through the registry's `host` option; the default `other` preserves uncertainty rather than inferring an agent identity. Model, generation latency and provider-reported token usage remain absent unless explicitly available; tool duration never becomes model latency. Schemas in `schemas/` use JSON Schema Draft 2020-12. `validateContract("capture-event" | "eval-result", value)` returns `{valid,errors}`; `error` and `skipped` evaluation results cannot report a pass. EvalResult separately accepts a nonnegative numeric `score`, a `dimensions` object of named numeric scores from 0–3, a bounded textual evaluation `rationale`, and typed diagnostics with optional messages. These evaluation fields are never added to public capture.

An outbox failure returns visible `capture.diagnostics` without undoing committed assessment or losing the consumed token. Every new private assessment receipt stores a `capture` pointer with its event ID, receipt path, outbox path and original host. After fixing the outbox, retry the original assessment input or call `recoverCapture(root, {attemptId})` from `src/evaluation/capture.mjs`; recovery reads only factual receipt fields and never grades again. Legacy committed receipts can also be recovered using their attempt ID. Restore events first atomically publish a synced factual receipt under `.concept-loom/capture/restores/`, outside the outbox. The returned `capture.receiptPath`, `eventId` and `timestamp` identify that immutable snapshot. `recoverCapture(root, {eventId})` replays the original restore event after the session advances, preserving its host, timestamp, revision and phase without storing learner content. If the receipt itself cannot be persisted, diagnostics report that failure without blocking later learning transactions; durable restore recovery requires that receipt. Malformed outbox content is reported and preserved for repair. Capture does not depend on an external evaluator, SDK or worker, and general capture cannot claim `lesson-published`; that event requires a later explicit artifact tool.

`createToolRegistry(root)` retains the nine existing MCP tools and their JSON-RPC transport. Local hosts can opt into `loom_validate_contract` and `loom_recover_capture` using `createToolRegistry(root, {evaluationTools: true})`, or disable automatic capture with `{capture: false}`. No evaluation tools are required for learning operations. `test/fixtures/contracts/ledger.json` maps the first eight executable structural cases to their fixtures and originating tests; the remaining 16 structural cases and the pedagogical suite belong to the later evaluation phase.

## Verify the project

```bash
npm ci --ignore-scripts
npm test
npm run check
npm run check:prompts
```

## License

MIT. Security reports: [SECURITY.md](SECURITY.md). Release history: [CHANGELOG.md](CHANGELOG.md).
