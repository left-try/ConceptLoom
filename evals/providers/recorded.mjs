import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDataset = fileURLToPath(new URL("../datasets/recorded.json", import.meta.url));

export default class RecordedProvider {
  constructor({ id = "conceptloom-recorded", config = {} } = {}) {
    this.providerId = id;
    this.config = config;
    this.outputs = config.outputs;
  }

  id() { return this.providerId; }

  async callApi(_prompt, context = {}) {
    const caseId = context.vars?.caseId;
    const candidateId = this.config.candidateId ?? "candidate-a";
    let outputs = this.outputs;
    if (!outputs && this.config.outputsFile) {
      const path = resolve(process.cwd(), this.config.outputsFile);
      const dataset = JSON.parse(await readFile(path, "utf8"));
      outputs = Object.fromEntries(dataset.cases.map(row => [row.caseId, Object.fromEntries(row.candidates.map(candidate => [candidate.id, candidate.output]))]));
    }
    if (!outputs) {
      const dataset = JSON.parse(await readFile(defaultDataset, "utf8"));
      outputs = Object.fromEntries(dataset.cases.map(row => [row.caseId, Object.fromEntries(row.candidates.map(candidate => [candidate.id, candidate.output]))]));
    }
    const value = outputs?.[caseId];
    const output = typeof value === "string" ? value : value?.[candidateId];
    if (typeof output !== "string") return { error: `No recorded output for case ${String(caseId)} and candidate ${candidateId}.` };
    return { output, cost: 0, metadata: { caseId, candidateId, recorded: true } };
  }
}

export { RecordedProvider };
