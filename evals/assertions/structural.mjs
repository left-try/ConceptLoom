import { evaluateDeterministic } from "../../src/evaluation/assertions.mjs";

export default (output, context = {}) => {
  const assertion = context.config ?? {};
  const candidate = {
    ...assertion,
    caseId: context.vars?.caseId ?? "promptfoo-case",
    markdown: assertion.type === "knowledge-links" || assertion.type === "citation" ? output : assertion.markdown,
    publicText: assertion.type === "concealment" ? output : assertion.publicText,
  };
  return evaluateDeterministic(candidate)[0].passed;
};
