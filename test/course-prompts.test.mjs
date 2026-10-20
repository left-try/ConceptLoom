import test from "node:test";
import assert from "node:assert/strict";
import { loadPrompt } from "../src/prompts/loader.mjs";

async function promptText(id) {
  const prompt = await loadPrompt(id, {});
  return prompt.messages.map(message => message.content).join("\n");
}

test("diagnosis separates preferences and self-report from knowledge evidence", async () => {
  const text = await promptText("diagnose");
  assert.match(text, /goal|цель/i);
  assert.match(text, /preference|предпочтен|расписан|time budget/i);
  assert.match(text, /checkpoint|knowledge check|проверк.*знани/i);
  assert.match(text, /self.report|самооцен|reported experience/i);
  assert.match(text, /save|persist|сохран/i);
});

test("course research requires opening source material and states actual coverage", async () => {
  const text = await promptText("research-course");
  assert.match(text, /open|read|fetch/i);
  assert.match(text, /metadata|summary|partial|full/i);
  assert.match(text, /syllabus/i);
  assert.match(text, /not.*(read|access)|не.*(прочитан|доступ)/i);
});

test("course planning adapts prerequisites and time estimates to the learner", async () => {
  const text = await promptText("plan-course");
  assert.match(text, /prerequisite|предпосыл/i);
  assert.match(text, /objective|цель урок/i);
  assert.match(text, /minute|duration|врем/i);
  assert.match(text, /source|источник/i);
  assert.match(text, /frontier|diagnos|диагност/i);
});

test("lesson prompt teaches one connection, includes an example, and leaves room for questions", async () => {
  const text = await promptText("teach-lesson");
  assert.match(text, /one concept|one connection|одн.*поняти/i);
  assert.match(text, /worked example|разобранн.*пример/i);
  assert.match(text, /limitation|ограничени/i);
  assert.match(text, /question|вопрос/i);
});

test("resume prompt continues the current lesson without claiming an unattended assessment", async () => {
  const text = await promptText("resume");
  assert.match(text, /current lesson|текущ.*урок/i);
  assert.match(text, /next step|следующ.*шаг/i);
  assert.match(text, /not.*complete|не.*заверш/i);
});

test("onboarding exposes four natural-language routes without mutating state", async () => {
  const text = await promptText("onboard");
  for (const phrase of ["learn a topic", "continue an existing course", "draft or connect a note", "prepare for a test"]) assert.match(text, new RegExp(phrase, "i"));
  assert.match(text, /special command/i);
  assert.match(text, /must not approve.*create a schedule.*write notes.*change learner state/i);
  assert.match(text, /one concise follow-up/i);
});

test("full lesson separates coach and learner time and reserves review for an answer", async () => {
  const text = await promptText("teach-lesson");
  assert.match(text, /coach explanation time.*learner practice time/i);
  assert.match(text, /worked example.*assigned exercise/i);
  assert.match(text, /clearly distinguish.*lesson.*assignment/i);
  assert.match(text, /wait for the selection, reveal the rationale, and respond to the chosen distractor/i);
  assert.match(text, /brief clarification request.*answer briefly/i);
});

test("practice defaults to quick single-choice with typed explanations reserved for specific goals", async () => {
  const text = await promptText("practice");
  assert.match(text, /single-choice questions the default/i);
  assert.match(text, /one tap or one letter/i);
  assert.match(text, /never require it for routine checks/i);
  assert.match(text, /free-response.*only.*objective.*requires/i);
  assert.match(text, /misconception/i);
});
