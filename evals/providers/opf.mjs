import { loadPrompt } from "../../src/prompts/loader.mjs";

export async function renderEvalPrompt({ id, inputs = {}, root } = {}) {
  const rendered = await loadPrompt(id, inputs, root ? { root } : {});
  const prompt = rendered.messages.map(message => `## ${message.role}\n${message.content}`).join("\n\n");
  return { id: rendered.id, digest: rendered.digest, messages: rendered.messages, prompt };
}
