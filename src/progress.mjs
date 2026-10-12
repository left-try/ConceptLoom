import { readFile, readdir } from "node:fs/promises";
import { resolveContainedPath } from "./storage/paths.mjs";
import { assertRecovery, commitTransaction, hashBytes, recoverTransactions, withWorkspaceLock } from "./storage/transactions.mjs";

const PHASES = new Set(["locate", "weave", "build", "transfer", "review", "complete"]);
const MODES = new Set(["guided", "practice", "review", "challenge"]);
const CHECKPOINT_DIMENSIONS = {
  choice: "recognition",
  "free-recall": "recall",
  prediction: "application",
  debugging: "application",
  transfer: "transfer",
};

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalText(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, label);
}

function textList(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => requiredText(entry, `${label}[${index}]`));
}

function objectValue(value, label) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function routeExtensionList(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("routeExtensions must be an array");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`routeExtensions[${index}] must be an object`);
    }
    return {
      concept: requiredText(entry.concept, `routeExtensions[${index}].concept`),
      dependsOn: textList(entry.dependsOn, `routeExtensions[${index}].dependsOn`) ?? [],
      reason: optionalText(entry.reason, `routeExtensions[${index}].reason`),
      addedAt: optionalText(entry.addedAt, `routeExtensions[${index}].addedAt`) ?? new Date().toISOString(),
    };
  });
}

function safeSessionId(value) {
  const id = requiredText(value, "sessionId");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
    throw new Error("sessionId may contain only letters, numbers, underscores, and hyphens");
  }
  return id;
}

function statePath(baseDirectory, sessionId) {
  return resolveContainedPath(baseDirectory, `.concept-loom/sessions/${safeSessionId(sessionId)}.json`);
}

async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveLearningState(baseDirectory, input) {
  return withWorkspaceLock(baseDirectory, async () => {
    assertRecovery(await recoverTransactions(baseDirectory));
    const sessionId = safeSessionId(input.sessionId);
    const destination = await statePath(baseDirectory, sessionId);
    const previous = await readState(destination);
    const updateMode = input.updateMode ?? "patch";
    if (!["patch", "snapshot"].includes(updateMode)) throw new Error("updateMode must be patch or snapshot");
    if (Object.hasOwn(input, "expectedRevision") && (previous?.revision ?? null) !== input.expectedRevision) {
      throw Object.assign(new Error("REVISION_CONFLICT: learning state changed"), { code: "REVISION_CONFLICT" });
    }
    const merged = { ...previous, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) };
    if (updateMode === "snapshot") {
      for (const key of ["topic", "goal", "phase", "nextStep"]) requiredText(input[key], key);
      for (const key of ["route", "secured", "gaps", "routeExtensions"]) merged[key] = input[key] ?? [];
    }
    const phase = requiredText(merged.phase, "phase").toLowerCase();
    if (!PHASES.has(phase)) throw new Error(`phase must be one of: ${[...PHASES].join(", ")}`);
    const mode = optionalText(merged.mode, "mode")?.toLowerCase() ?? "guided";
    if (!MODES.has(mode)) throw new Error(`mode must be one of: ${[...MODES].join(", ")}`);

    const now = new Date().toISOString();
    const state = {
      ...previous,
      schemaVersion: 3,
      sessionId,
      topic: requiredText(merged.topic, "topic"),
      goal: requiredText(merged.goal, "goal"),
      phase,
      mode,
      notebookPath: optionalText(merged.notebookPath, "notebookPath"),
      route: textList(merged.route, "route") ?? [],
      secured: textList(merged.secured, "secured") ?? [],
      gaps: textList(merged.gaps, "gaps") ?? [],
      evidence: objectValue(merged.evidence, "evidence") ?? {},
      routeExtensions: routeExtensionList(merged.routeExtensions) ?? [],
      currentStep: optionalText(merged.currentStep, "currentStep"),
      nextStep: requiredText(merged.nextStep, "nextStep"),
      learnerContext: optionalText(merged.learnerContext, "learnerContext"),
      lastCheckpoint: merged.lastCheckpoint,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      revision: (previous?.revision ?? 0) + 1,
    };

    const path = `.concept-loom/sessions/${sessionId}.json`;
    const writes = [{ path, value: state, encoding: "json" }];
    await addMigrationBackup(baseDirectory, path, previous, writes);
    await commitTransaction(baseDirectory, { checks: [{ path, expectedHash: await fileHash(destination) }], writes });
    return state;
  });
}

async function fileHash(path) {
  try { return hashBytes(await readFile(path)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function addMigrationBackup(root, path, previous, writes) {
  if (!previous || previous.schemaVersion === 3) return;
  if (![1, 2].includes(previous.schemaVersion)) throw new Error(`unsupported learning state schema: ${previous.schemaVersion}`);
  const backup = `${path}.v${previous.schemaVersion}.bak`;
  if (await fileHash(await resolveContainedPath(root, backup)) === null) {
    writes.unshift({ path: backup, value: await readFile(await resolveContainedPath(root, path), "utf8"), encoding: "utf8" });
  }
}

async function loadAndMigrate(root, sessionId) {
  const path = `.concept-loom/sessions/${safeSessionId(sessionId)}.json`;
  const destination = await resolveContainedPath(root, path);
  const previous = await readState(destination);
  if (!previous || previous.schemaVersion === 3) return previous;
  const writes = [];
  await addMigrationBackup(root, path, previous, writes);
  const state = { ...previous, schemaVersion: 3, mode: previous.mode ?? "guided", route: previous.route ?? [], secured: previous.secured ?? [], gaps: previous.gaps ?? [], evidence: previous.evidence ?? {}, routeExtensions: previous.routeExtensions ?? [], revision: previous.revision ?? 0 };
  writes.push({ path, value: state, encoding: "json" });
  await commitTransaction(root, { checks: [{ path, expectedHash: await fileHash(destination) }], writes });
  return state;
}

export async function loadLearningState(baseDirectory, input = {}) {
  return withWorkspaceLock(baseDirectory, async () => {
    assertRecovery(await recoverTransactions(baseDirectory));
    if (input.sessionId) {
      const sessionId = safeSessionId(input.sessionId);
      const state = await loadAndMigrate(baseDirectory, sessionId);
      if (!state) throw new Error(`learning session '${sessionId}' was not found`);
      return { state };
    }

    const directory = await resolveContainedPath(baseDirectory, ".concept-loom/sessions");
    let names;
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    } catch (error) {
      if (error?.code === "ENOENT") return { state: null, sessions: [] };
      throw error;
    }

    const states = [];
    for (const name of names) states.push(await loadAndMigrate(baseDirectory, name.slice(0, -5)));
    const sorted = states
      .filter(Boolean)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      state: sorted[0] ?? null,
      sessions: sorted.map(({ sessionId, topic, goal, phase, nextStep, updatedAt }) => ({
        sessionId,
        topic,
        goal,
        phase,
        nextStep,
        updatedAt,
      })),
    };
  });
}

export async function listDueReviews(baseDirectory, input = {}) {
  const now = input.now ? new Date(requiredText(input.now, "now")) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("now must be an ISO date");
  const { sessions } = await loadLearningState(baseDirectory);
  const due = [];
  for (const summary of sessions) {
    const { state } = await loadLearningState(baseDirectory, { sessionId: summary.sessionId });
    for (const [concept, evidence] of Object.entries(state.evidence ?? {})) {
      if (!evidence?.reviewAfter) continue;
      const reviewAt = new Date(evidence.reviewAfter);
      if (!Number.isNaN(reviewAt.getTime()) && reviewAt <= now) {
        due.push({
          sessionId: state.sessionId,
          topic: state.topic,
          concept,
          reviewAfter: evidence.reviewAfter,
          lastFormat: evidence.lastFormat,
          transferPassed: evidence.transferPassed === true,
        });
      }
    }
  }
  due.sort((left, right) => left.reviewAfter.localeCompare(right.reviewAfter));
  return { asOf: now.toISOString(), due };
}

function addUnique(items, value) {
  return value && !items.includes(value) ? [...items, value] : items;
}

export async function recordCheckpointAssessment(baseDirectory, input, assessment) {
  return withWorkspaceLock(baseDirectory, async () => {
    const sessionId = safeSessionId(input.sessionId);
    const { state: previous } = await loadLearningState(baseDirectory, { sessionId });
    const securedConnection = optionalText(input.securedConnection, "securedConnection");
    const gap = optionalText(input.gap, "gap");
    const secured = assessment.outcome === "accurate"
      ? addUnique(previous.secured ?? [], securedConnection)
      : previous.secured ?? [];
    const gaps = assessment.outcome === "knowledge-gap"
      ? addUnique(previous.gaps ?? [], gap ?? input.currentStep ?? previous.currentStep)
      : previous.gaps ?? [];
    const evidenceConcept = optionalText(input.evidenceConcept, "evidenceConcept")
      ?? securedConnection
      ?? input.currentStep
      ?? previous.currentStep;
    const evidence = { ...(previous.evidence ?? {}) };
    if (evidenceConcept) {
      const earlier = evidence[evidenceConcept] ?? {};
      const format = assessment.format ?? "choice";
      const dimension = CHECKPOINT_DIMENSIONS[format] ?? "recognition";
      const dimensionResult = assessment.outcome === "accurate" ? "demonstrated" : "needs-work";
      const consecutiveSuccesses = assessment.outcome === "accurate" ? (earlier.consecutiveSuccesses ?? 0) + 1 : 0;
      evidence[evidenceConcept] = {
        ...earlier,
        attempts: (earlier.attempts ?? 0) + 1,
        successes: (earlier.successes ?? 0) + (assessment.outcome === "accurate" ? 1 : 0),
        consecutiveSuccesses,
        dimensions: { ...(earlier.dimensions ?? {}), [dimension]: dimensionResult },
        lastFormat: format,
        lastOutcome: assessment.outcome,
        lastConfidence: assessment.confidence,
        lastCalibration: assessment.calibration,
        hintUsed: input.hintUsed === true,
        transferPassed: earlier.transferPassed === true || (format === "transfer" && assessment.outcome === "accurate"),
        lastAttemptAt: new Date().toISOString(),
        lastSuccessfulRetrieval: assessment.outcome === "accurate"
          ? new Date().toISOString()
          : earlier.lastSuccessfulRetrieval,
        reviewAfter: nextReviewDate(consecutiveSuccesses, assessment.outcome),
      };
    }

    return saveLearningState(baseDirectory, {
      ...previous,
      expectedRevision: input.expectedRevision ?? previous.revision,
      currentStep: input.currentStep ?? previous.currentStep,
      nextStep: requiredText(input.nextStep, "nextStep"),
      secured,
      gaps,
      evidence,
      lastCheckpoint: {
        outcome: assessment.outcome,
        selected: assessment.selected,
        response: assessment.response,
        format: assessment.format ?? "choice",
        confidence: assessment.confidence,
        calibration: assessment.calibration,
        assessedAt: new Date().toISOString(),
      },
    });
  });
}

function nextReviewDate(consecutiveSuccesses, outcome) {
  const intervals = [1, 3, 7, 14, 30];
  const days = outcome === "accurate"
    ? intervals[Math.min(Math.max(consecutiveSuccesses - 1, 0), intervals.length - 1)]
    : 1;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
