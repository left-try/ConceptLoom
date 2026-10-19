# Phase 3 host acceptance

The automated adapter contract tests use synthetic capability reports and receipts. They do not prove that a real host scheduler or durable workspace is available. The MCP registry accepts trusted `hostAdapter.verifyCapabilities` and `hostAdapter.verifyReceipt` functions; without them, schedule preparation returns `manual-setup` and a caller-provided receipt cannot create an active binding.

| Host | Version | Fresh scheduled chat | Durable workspace | Native receipt | Manual UAT |
|---|---|---:|---:|---|---|
| Codex | Not run | Unverified | Unverified | None recorded | Pending |
| Claude Code Desktop | Not run | Unverified | Unverified | None recorded | Pending |
| ChatGPT/cloud | Not run | Unverified | Unverified | None recorded | Pending |

Before marking a host ready, run the two-lesson acceptance flow from `docs/superpowers/plans/2026-10-13-conceptloom-courses-test-plan.md`, record the actual host version and receipt, confirm fresh lesson chats, learner Q&A, replay protection, pause and missed-run behavior, then disable the temporary schedule.
