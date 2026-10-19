const hosts = new Set(["codex", "claude-code", "chatgpt", "other"]);
const booleans = ["questions", "search", "fetch", "freshScheduledChat", "mcpAppUi", "localHtml", "codingExecutor", "durableWorkspace"];
export function validateCapabilities(report) {
  if (!report || !hosts.has(report.host) || booleans.some(key => typeof report[key] !== "boolean")) throw Object.assign(new Error("capability report must include a supported host and observed boolean capabilities"), { code: "INVALID_CAPABILITY_REPORT" });
  if (report.durableWorkspace && (typeof report.workspaceRoot !== "string" || !report.workspaceRoot.trim())) throw Object.assign(new Error("durable workspace capability requires workspaceRoot"), { code: "INVALID_CAPABILITY_REPORT" });
  if (!report.durableWorkspace && report.workspaceRoot) throw Object.assign(new Error("workspaceRoot contradicts durableWorkspace=false"), { code: "INVALID_CAPABILITY_REPORT" });
  return structuredClone(report);
}
