# Study Companion and Obsidian Knowledge Graph — Specification

**Status:** Draft for user review
**Scope:** Cross-course learning companion, editable notes, and provenance-backed concept links.
**Related:** [platform design](2026-10-12-conceptloom-learning-platform-design.md), [Knowledge plan](../plans/2026-10-12-conceptloom-knowledge.md), [Courses phase](2026-10-13-conceptloom-courses.md).

## Goal

Let a learner explore and take notes with awareness of the active course, while building a useful Obsidian graph from reviewed, source-grounded notes without conflating curriculum, conceptual relationships and mastery.

## Behavior and boundaries

- Companion workflows: explain a new topic at the learner's current frontier; connect it to the active course; turn learner-provided lecture/source material into a note draft; prepare retrieval/review; explore a topic outside the course without changing its roadmap.
- The assistant receives only relevant course/profile/knowledge context through a bounded context capsule. Course changes, mastery changes and note writes use their existing domain operations; free-form conversation cannot mutate them directly.
- Knowledge notes are user-readable Markdown in the configured vault. Concept notes and typed relations may link to sources, fragments, courses, lessons and examples. Every generated factual relation carries provenance (source hash and locator, or clearly marked learner-provided/self-reported basis).
- Suggested notes/links are proposals until accepted or explicitly configured for safe generated sections. Updates preserve user-authored body and unknown metadata; hash conflicts stop the write.
- Graph indexing is derived and rebuildable. It is not the canonical course order or the learner evidence ledger. Obsidian's graph view is a projection of ordinary note links and metadata, not a separate source of truth.
- No automatic web crawler or source downloader is added. Unverified or ambiguous relations remain suggestions with uncertainty, not asserted facts.

## Acceptance criteria

- **SC-1 Course-aware help:** A request may use the active course's goal/current lesson/prerequisites and relevant notes; unrelated private state is excluded.
- **SC-2 No silent course edits:** Exploratory Q&A cannot change roadmap, progress, approvals or schedule. A proposed course change is shown for explicit approval.
- **SC-3 Safe note drafting:** A draft includes title, concise body, proposed links and provenance; user text is preserved and source coverage is labeled honestly.
- **SC-4 Graph semantics:** The index distinguishes concept, source, fragment, course, lesson and exercise nodes; typed edges distinguish dependency, example, contrast, application and source attribution.
- **SC-5 Provenance:** Every source-derived claim/link resolves to the exact source revision/locator; missing or stale provenance is diagnostic and cannot be marked verified.
- **SC-6 Conflict-safe Obsidian writes:** Existing note bodies and unknown frontmatter survive updates; stale hash, duplicate generated markers or ambiguous path prevent mutation.
- **SC-7 Separation of models:** Course order, concept graph edges and learner mastery are independently represented and exported; self-report never becomes assessed mastery.
- **SC-8 Rebuildability:** Reindexing the vault yields stable node/edge identities and does not modify authored notes.

## Test plan

- Markdown/YAML round-trip tests preserve body bytes, comments/unknown fields and links; malformed metadata and duplicate markers produce zero writes.
- Graph fixtures cover aliases, Cyrillic names, anchors, ambiguous wikilinks, cycles, fenced code, duplicate basenames, stale source hashes and missing locators.
- Provenance tests verify exact source hash/locator and distinguish source-derived, learner-provided, inferred and unverified relations.
- Access/context tests assert active course scope only and ensure assessment attempts/private rubrics do not enter notes or assistant context unless explicitly requested.
- Obsidian vault acceptance: open exported/copied vault, navigate concept→source fragment→lesson, hand-edit a note, reindex and confirm edit is retained.
- Recovery test: conflict or interrupted update leaves original note intact and returns a repairable proposal.

## Out of scope

Teacher authoring mode, classroom/cohort knowledge graphs, automatic internet crawling, and automatic acceptance of model-generated relations.
