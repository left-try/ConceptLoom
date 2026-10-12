# ConceptLoom Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сохранять найденные материалы и заметки в одном переносимом OKF/Obsidian corpus с поиском, provenance и графом.

**Architecture:** Markdown в `vault/Knowledge` хранит авторское знание; assets — оригиналы. Private manifests/chunks/indexes воспроизводимы. Технические сведения manifest показываются в controlled generated blocks, личные заметки индексируются отдельно.

**Tech Stack:** Node >=20, YAML Document API, mdast-util-from-markdown с GFM, optional Python >=3.10/Docling; локальный JSON inverted index без vector DB.

**Spec:** [Разделы 4–6, 7, 11](../specs/2026-10-12-conceptloom-learning-platform-design.md); [Foundation](2026-10-12-conceptloom-foundation.md).

## Global Constraints

- Один набор Markdown знаний читают агент и Obsidian.
- Промпты организуются по OPF, знания — по официальному OKF v0.2 с учебным профилем ConceptLoom.
- Tracelet исключен из текущего объема: не добавляем его SDK, importer, worker или зависимости.
- Canonical paths — обычные Markdown links; wikilinks принимаются без скрытой конвертации.
- Unknown type/keys сохраняются. Standard conformance и strict course readiness — разные проверки.
- Оригиналы неизменны; metadata/syllabus/summary не выдаются за полный материал. Ошибки extraction видимы.
- okf-agent optional backend; отсутствие нового upstream knowledge profile не блокирует этот этап.

## Review Focus

1. YAML aliases/duplicate keys/ошибки: K1 `invalid YAML cannot be rewritten`.
2. Syllabus-only и частично прочитанная книга: K2 `coverage does not imply full access`.
3. Кириллица/anchors/одинаковые basename: K3 `ambiguous wikilink is diagnostic`.
4. OCR формул и таблиц: K4 `low quality page blocks evidence use`.
5. Ручная правка и export symlink: K5 `conflict preserves body`, `export rejects asset escape`.

### K1: OKF parser и образовательный профиль

**Files:** Create `src/knowledge/format.mjs`, `src/knowledge/profile.mjs`, `schemas/knowledge-node.schema.json`, `test/knowledge-format.test.mjs`, `test/fixtures/knowledge/`; Modify `package.json`, `package-lock.json`.

**Interfaces:** Produces `initializeKnowledge(root)->Promise<{bundleRoot,vaultRoot}>`, `parseKnowledge(markdown,{path,bundleRoot})->{node,document,body,diagnostics}`, `validateKnowledge(parsed,{strictProfile=false}={})->Diagnostics[]`, `serializeKnowledge(parsed,{metadataPatch={},body}={})->string`. Node `{path,id,uid?,type,title?,aliases:[],sources:[],relations:[],bodyHash}`; official ID=relative path without .md. profile `conceptloom/1`, UID regex same safe ID as session IDs, relations kinds из spec. Unknown standard keys/types разрешены; profile-owned fields строго валидируются.

- [ ] **1. Write failing tests:** `type required except reserved docs`, `unknown fields survive roundtrip`, `invalid YAML cannot be rewritten`, `root index accepts okf_version`, `nested index rejects frontmatter`, `log has date headings`, `verified remains independent of mastery`. Assert UID/title edit does not change filename; malformed YAML/duplicate keys produces errors and zero writes.
- [ ] **2. Run:** `node --test test/knowledge-format.test.mjs`; expect missing module/profile failures.
- [ ] **3. Implement:** initialize vault/Knowledge/Personal and index/log files idempotently without overwriting existing documents; root index declares okf_version "0.2", log uses date headings. Source import and course projection call initializer. Use YAML document AST for metadata updates, preserve untouched body bytes/comments. Define Source Fragment/Reference types and relation target bundle-root semantics. Keep verified/generated semantics per official OKF; unknown conventions remain intact. Machine changes append concise date-stamped log entries after committed update.
- [ ] **4. Run:** same tests; expect standard fixtures and strict profile fixtures both pass with distinct diagnostic severities.
- [ ] **5. Commit:** module/schema/fixtures, message `feat: support portable OKF learning notes`.

### K2: Source import, immutable assets и chunks

**Files:** Create `src/sources/import.mjs`, `src/sources/chunks.mjs`, `src/sources/tools.mjs`, `schemas/source-manifest.schema.json`, `schemas/research-receipt.schema.json`, `test/sources.test.mjs`; Modify `src/tool-registry.mjs`, `docs/en/learning-with-source-materials.md`, `docs/ru/learning-with-source-materials.md`.

**Interfaces:** Consumes F1/F5/K1. Produces `importSource(root,{uid?,resource,title,author?,language?,version?,coverage,content?,localFile?,receipt})->Promise<SourceManifest>`, `prepareSource(root,{sourceUid,extraction})->Promise<SourceManifest>`, `chunkSource({sourceUid,contentHash,sections,maxChars=4000})->Chunk[]`. Manifest revision schema 1; coverage enum из overview; originalStorage `asset|external|none`. Locator `{sourceUid,contentHash,page?,printedPage?,section?,bbox?,timestamp?,codeRevision?,lines?}`. Chunks `{id,sourceUid,contentHash,text,locator}`; split heading/page first, long pieces by paragraph.

- [ ] **1. Write failing tests:** `book saved with original hash`, `same import is idempotent`, `new source version preserves old locators`, `coverage does not imply full access`, `reference links to course and fragment`, `path traversal rejected`, `metadata does not produce fake chunks`. Assert two versions retained; locator hash exactly matches indexed asset; summary chunk explicitly marked as summary.
- [ ] **2. Run:** `node --test test/sources.test.mjs`; expect new behavior failures.
- [ ] **3. Implement:** import content provided by host/fetched file, validate receipt `{query,openedResource,fetchedAt,representation,coverage,contentHash?,locators?,limitations:[]}`. Maximum asset 250 MiB by default, caller may set explicit workspace limit; stream hash/copy. Write asset version under `assets/<uid>/<hash>/`, Reference generated block links current version. Original remains read-only by policy. Meaningful chapter/section gets Source Fragment, internal chunks do not all become notes. Register `loom_import_source`, `loom_prepare_source`, `loom_get_source`; no autonomous downloader in this increment.
- [ ] **4. Run:** tests and MCP tool catalog fixture; expect source manifest/Reference/chunks consistent after restart. User-source docs explain storage/coverage/external dependencies.
- [ ] **5. Commit:** pipeline/tools/docs, message `feat: import source materials with provenance and locators`.

### K3: Graph indexing, search и чтение заметок

**Files:** Create `src/knowledge/links.mjs`, `src/knowledge/index.mjs`, `src/knowledge/search.mjs`, `src/knowledge/tools.mjs`, `test/knowledge-index.test.mjs`, `test/knowledge-search.test.mjs`; Modify `src/tool-registry.mjs`, `package.json`, `package-lock.json`.

**Interfaces:** Consumes K1/K2. Produces `indexKnowledge(root,{includePersonal=false}={})->Promise<{revision,nodes,edges,diagnostics}>`, `searchKnowledge(root,{query,limit=10,cursor?,scope='knowledge'})->Promise<{hits,nextCursor?}>`, `getKnowledgeNode(root,{uid?,path?})->Promise<Node>`, `getNeighborhood(root,{uid,depth=1,limit=50})->Promise<{nodes,edges,truncated}>`. depth max 3, limit max 200; IDs/paths unique within selected scope. Hits `{uid?,path,excerpt,score,locator?,sourceUid?}`.

- [ ] **1. Write failing tests:** `source lesson course traversable`, `ambiguous wikilink is diagnostic`, `code fences do not create edges`, `percent encoded path and anchor resolve`, `multiple occurrences keep edge provenance`, `search finds Russian alias and chapter text`, `private assessments absent`, `changed hash invalidates cursor`.
- [ ] **2. Run:** `node --test test/knowledge-index.test.mjs test/knowledge-search.test.mjs`; expect graph/search missing.
- [ ] **3. Implement:** parse normal links/definitions/footnotes via Markdown AST, scan wikilinks only within eligible text nodes. Index metadata/body/chunks with Unicode lowercase tokenization and deterministic term frequency scoring; postings and hashes stored `.concept-loom/indexes/knowledge.json`. Merge body/source/typed edges by canonical endpoints+kind, retain occurrence locators. Personal nodes get separate scope and no OKF conformance. Register `loom_search_knowledge`, `loom_read_knowledge`, `loom_knowledge_graph`; reindex changed files before serving stale results.
- [ ] **4. Run:** tests and fixture of 1,000 small notes; assert bounded traversal/pagination, cycle termination, stable ranking, no unsafe root traversal. Performance report records elapsed time instead of a guessed universal threshold.
- [ ] **5. Commit:** modules/tools/fixtures, message `feat: search and traverse the learning knowledge graph`.

### K4: Optional document conversion и OCR с контролем качества

**Files:** Create `python/pyproject.toml`, `python/conceptloom_documents/{__init__,__main__,convert,quality}.py`, `python/tests/test_documents.py`, `test/document-adapter.test.mjs`, `src/sources/document-adapter.mjs`, `test/fixtures/documents/manifest.json`; Modify `src/sources/tools.mjs`, source material docs.

**Interfaces:** Produces `convertDocument(root,{sourceUid,pythonExecutable,ocrMode='auto',languages=['en','ru']})->Promise<{pages,artifacts,diagnostics}>`. Python stdin request `{schemaVersion:1,inputPath,outputDirectory,ocrMode,languages,resumeFrom?}`, stdout JSONL progress + final result (logs stderr). Page `{page,printedPage?,text,blocks,quality:{status,signals},contentHash}`; status `usable|needs-review|failed`, not fabricated engine confidence.

- [ ] **1. Write failing tests:** `missing converter gives actionable error`, `resume processes failed pages only`, `low quality page blocks evidence use`, `page locator survives reimport`, `conversion timeout preserves original`. Python fixtures cover born-digital/scanned RU/EN, two-column order, table, formula, rotation, mixed text/scans. Six page kinds × two languages =12 hand-authored benchmark pages; ground truth excludes third-party copyright texts.
- [ ] **2. Run:** `node --test test/document-adapter.test.mjs`; `python -m unittest discover -s python/tests`; expect adapter/converter missing. Docling-specific tests explicit skip if optional extra absent, recorded as missing integration evidence.
- [ ] **3. Implement:** separate optional Docling extra, pin tested install in Python lock/requirements artifact. Use DocumentConverter local files, export structure with page provenance; auto OCR reruns empty/suspect pages. Heuristics include replacement chars, empty text, suspicious order/table loss; heuristic flags are diagnostics, not accuracy scores. Node worker uses argument array, timeout 120s per page batch, bounded stdout and resumable artifact files; no dependency installation in MCP request. Register document preparation through existing `loom_prepare_source` mode.
- [ ] **4. Run:** mock adapter/Python unit suite, then explicit local benchmark with installed converter; compare normalized character error and table/formula preservation to ground truth. Mark engine integration ready only when benchmark reviewed; persist tool/options/version and per-page status.
- [ ] **5. Commit:** adapter/converter/fixtures/docs, message `feat: prepare documents with resumable OCR provenance`.

### K5: Conflict-safe updates, export и optional okf-agent boundary

**Files:** Create `src/knowledge/update.mjs`, `src/knowledge/export.mjs`, `src/knowledge/backend.mjs`, `test/knowledge-update.test.mjs`, `test/knowledge-export.test.mjs`, `docs/okf-agent-knowledge-contract.md`; Modify `src/knowledge/tools.mjs`, `docs/ru/README.md`.

**Interfaces:** Produces `updateKnowledge(root,{path,expectedHash,metadataPatch={},blockId?,generatedBody?})->Promise<{hash,diagnostics}>`, `exportKnowledge(root,{format:'okf'|'obsidian',destination,includeAssets=true})->Promise<{manifest,diagnostics}>`. Destination contained in workspace `exports/` by default; cannot overlap source vault. Backend interface `{index(root,options),search(root,query),neighborhood(root,query),validate(root,options)}` delegates to local implementation until explicit compatible upstream selection. No current upstream commands are assumed to implement it.

- [ ] **1. Write failing tests:** `conflict preserves body`, `duplicate markers stop update`, `unknown YAML survives`, `export rejects asset escape`, `relocated vault keeps links`, `OKF export omits Personal and private data`, `unavailable backend falls back explicitly`. Assert no writes on hash mismatch; all exported assets enumerated, external missing assets declared.
- [ ] **2. Run:** `node --test test/knowledge-update.test.mjs test/knowledge-export.test.mjs`; expect update/export missing.
- [ ] **3. Implement:** markers `<!-- conceptloom:generated:<id>:start/end -->`; exactly one well-formed block per ID. Journal updates + expected hash under F1 lock; preserve body outside block. Export copies portable assets, validates relative links, records nonportable dependencies. Register `loom_update_knowledge`, `loom_export_knowledge`. Publish upstream knowledge-profile contract with schema fixtures/search/traversal examples; adapter activation requires capability handshake and these fixtures, does not modify external repository.
- [ ] **4. Run:** all Knowledge tests; manually open copied vault in Obsidian and navigate source→fragment→lesson; agent reads same files. Export report identifies unresolved optional links without mislabeling standard conformance failure.
- [ ] **5. Commit:** updates/export/backend/docs, message `feat: preserve editable notes and export Obsidian knowledge`.
