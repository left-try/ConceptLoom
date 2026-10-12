import test from "node:test";
import assert from "node:assert/strict";
import { composeCheckpoint, assessCheckpoint, resetCheckpointsForTests } from "../src/checkpoints.mjs";
import * as checkpoints from "../src/checkpoints.mjs";

test.beforeEach(() => resetCheckpointsForTests());

function choiceCard() {
  return composeCheckpoint({ prompt: "Pick one", choices: [{ key: "a", label: "A" }, { key: "b", label: "B" }], expected: "a", rationale: "A is expected.", mix: false });
}

test("invalid answer does not consume token", () => {
  for (const invalid of [{ selected: "missing" }, { selected: "a", confidence: 101 }, { selected: ["a", "b"] }, { selected: ["a", 42] }]) {
    const card = choiceCard();
    assert.throws(() => assessCheckpoint({ token: card.token, ...invalid }));
    assert.equal(assessCheckpoint({ token: card.token, selected: "a" }).outcome, "accurate");
  }
  const card = composeCheckpoint({ format: "free-recall", prompt: "Recall", criteria: ["Explains A"], rationale: "A" });
  assert.throws(() => assessCheckpoint({ token: card.token, response: "A", verdict: "invalid" }));
  assert.equal(assessCheckpoint({ token: card.token, response: "A", verdict: "accurate" }).outcome, "accurate");
});

test("expired card requires a fresh checkpoint", t => {
  const card = choiceCard();
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 6 * 60 * 60 * 1000 + 1);
  assert.throws(() => checkpoints.evaluateCheckpoint({ token: card.token, selected: "a" }), /unknown or expired/);
});

test("evaluation peeks until explicit consumption", () => {
  assert.equal(typeof checkpoints.evaluateCheckpoint, "function");
  assert.equal(typeof checkpoints.consumeCheckpoint, "function");
  const card = choiceCard();
  const input = { token: card.token, selected: "a" };
  assert.deepEqual(checkpoints.evaluateCheckpoint(input), checkpoints.evaluateCheckpoint(input));
  checkpoints.consumeCheckpoint(card.token);
  assert.throws(() => checkpoints.evaluateCheckpoint(input), /unknown or expired/);
});

test("public choices cannot mutate private grading data", () => {
  const card = choiceCard();
  card.choices[0].key = "injected";
  card.choices.push({ key: "extra", label: "Extra" });
  assert.equal(assessCheckpoint({ token: card.token, selected: "a" }).outcome, "accurate");
});

test("frames a checkpoint without leaking its key or rationale", () => {
  const card = composeCheckpoint({
    prompt: "Which shape has three sides?",
    choices: [{ key: "triangle", label: "Triangle" }, { key: "square", label: "Square" }],
    expected: "triangle",
    rationale: "A triangle is defined by its three sides.",
  }, () => 0.5);
  assert.equal(card.choices.length, 2);
  assert.equal("expected" in card, false);
  assert.equal("rationale" in card, false);
});

test("grades an exact multi-selection", () => {
  const card = composeCheckpoint({
    prompt: "Pick primes",
    choices: [{ key: "2", label: "2" }, { key: "3", label: "3" }, { key: "4", label: "4" }],
    expected: ["2", "3"],
    rationale: "Two and three have exactly two positive divisors.",
    multiple: true,
    mix: false,
  });
  const result = assessCheckpoint({ token: card.token, selected: ["3", "2"] });
  assert.equal(result.outcome, "accurate");
});

test("treats an admitted gap separately from a wrong guess", () => {
  const card = composeCheckpoint({
    prompt: "Pick one",
    choices: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
    expected: "a",
    rationale: "A is expected.",
  });
  const result = assessCheckpoint({ token: card.token, selected: "__gap__" });
  assert.equal(result.outcome, "knowledge-gap");
  assert.equal(result.accurate, false);
});

test("checkpoint tokens can only be assessed once", () => {
  const card = composeCheckpoint({
    prompt: "Pick one",
    choices: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
    expected: "a",
    rationale: "A is expected.",
  });
  assessCheckpoint({ token: card.token, selected: "a" });
  assert.throws(() => assessCheckpoint({ token: card.token, selected: "a" }), /unknown or expired/);
});

test("frames and assesses an open transfer checkpoint without leaking criteria", () => {
  const card = composeCheckpoint({
    format: "transfer",
    prompt: "Apply the principle to a new case.",
    criteria: ["Names the relevant constraint", "Justifies the decision"],
    rationale: "Both the constraint and its consequence are needed.",
  });
  assert.equal(card.format, "transfer");
  assert.equal("criteria" in card, false);
  assert.equal("rationale" in card, false);

  const result = assessCheckpoint({
    token: card.token,
    response: "The new case is limited by the same constraint, so the decision follows.",
    verdict: "accurate",
    confidence: 82,
  });
  assert.equal(result.outcome, "accurate");
  assert.equal(result.calibration, "well-calibrated");
  assert.equal(result.criteria.length, 2);
});

test("detects confident incorrect answers and validates confidence", () => {
  const first = composeCheckpoint({
    prompt: "Pick one",
    choices: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
    expected: "a",
    rationale: "A is expected.",
  });
  const result = assessCheckpoint({ token: first.token, selected: "b", confidence: 90 });
  assert.equal(result.calibration, "overconfident");

  const second = composeCheckpoint({
    prompt: "Pick one",
    choices: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
    expected: "a",
    rationale: "A is expected.",
  });
  assert.throws(() => assessCheckpoint({ token: second.token, selected: "a", confidence: 101 }), /0 to 100/);
});
