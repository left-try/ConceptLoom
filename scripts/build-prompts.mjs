import { buildReferences } from "../src/prompts/loader.mjs";

const result = await buildReferences({ check: process.argv.includes("--check") });
if (result.changedPaths.length) process.stdout.write(`${process.argv.includes("--check") ? "Drift detected" : "Updated"}: ${result.changedPaths.join(", ")}\n`);
else process.stdout.write("Prompt references are synchronized.\n");
