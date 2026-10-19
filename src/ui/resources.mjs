import { buildUiHtml, LEARNING_VIEW_URI } from "./views.mjs";

export async function listUiResources() {
  return [{
    uri: LEARNING_VIEW_URI,
    name: "conceptloom-learning-view",
    title: "ConceptLoom learning view",
    description: "Self-contained inline course roadmap, learning graph and practice view.",
    mimeType: "text/html;profile=mcp-app",
  }];
}

export async function readUiResource(uri) {
  if (uri !== LEARNING_VIEW_URI) throw Object.assign(new Error(`unknown UI resource: ${uri}`), { code: "RESOURCE_NOT_FOUND" });
  const html = await buildUiHtml({ nodes: [], edges: [], exercises: [], truncated: false });
  return { contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: html, _meta: { ui: { csp: {} } } }] };
}
