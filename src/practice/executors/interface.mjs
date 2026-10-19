export function validateExecutor(executor) {
  if (!executor || typeof executor.available !== "function" || typeof executor.run !== "function") {
    throw Object.assign(new Error("executor must implement available() and run()"), { code: "INVALID_EXECUTOR" });
  }
  return executor;
}
