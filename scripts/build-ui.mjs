#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUiHtml } from "../src/ui/views.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(root, "dist/learning-view.html");
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, await buildUiHtml({ nodes: [], edges: [], exercises: [], truncated: false }), "utf8");
process.stdout.write(`Built ${destination}\n`);
