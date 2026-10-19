import { spawn as nodeSpawn } from "node:child_process";

const DEFAULT_LIMITS = { timeoutMs: 10_000, outputBytes: 65_536, memoryMb: 128, cpuCount: 1, pids: 64 };
const IMAGE = /^sha256:[a-f0-9]{64}$/i;

function collect(child, limit) {
  let stdout = "", stderr = "", stdoutTruncated = false, stderrTruncated = false;
  let used = 0;
  const append = (current, chunk, mark) => {
    const remaining = Math.max(0, limit - used);
    const bytes = Buffer.from(chunk).subarray(0, remaining);
    used += bytes.length;
    return { value: current + bytes.toString("utf8"), truncated: mark || Buffer.byteLength(chunk) > remaining };
  };
  child.stdout?.on("data", chunk => { const result = append(stdout, chunk, stdoutTruncated); stdout = result.value; stdoutTruncated = result.truncated; });
  child.stderr?.on("data", chunk => { const result = append(stderr, chunk, stderrTruncated); stderr = result.value; stderrTruncated = result.truncated; });
  return {
    get stdout() { return stdout; }, get stderr() { return stderr; },
    get stdoutTruncated() { return stdoutTruncated; }, get stderrTruncated() { return stderrTruncated; },
  };
}

function runProcess(spawn, binary, args, { timeoutMs, outputBytes }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let child;
    try { child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { reject(error); return; }
    const output = collect(child, outputBytes);
    let timedOut = false, settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", error => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
    child.on("close", exitCode => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ status: timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed", exitCode, ...output, durationMs: Date.now() - started });
    });
  });
}

export function dockerArguments({ stagingPath, imageDigest, command, limits = {} }) {
  if (!IMAGE.test(imageDigest ?? "")) throw Object.assign(new Error("Docker image must be pinned by sha256 digest"), { code: "INVALID_IMAGE_DIGEST" });
  if (!Array.isArray(command) || !command.length || command.some(value => typeof value !== "string" || !value || value.includes("\0"))) throw Object.assign(new Error("runner command must be a non-empty argv array"), { code: "INVALID_RUNNER_COMMAND" });
  const requested = { ...DEFAULT_LIMITS, ...limits };
  const bounds = {
    timeoutMs: Math.min(DEFAULT_LIMITS.timeoutMs, requested.timeoutMs),
    outputBytes: Math.min(DEFAULT_LIMITS.outputBytes, requested.outputBytes),
    memoryMb: Math.min(DEFAULT_LIMITS.memoryMb, requested.memoryMb),
    cpuCount: Math.min(DEFAULT_LIMITS.cpuCount, requested.cpuCount),
    pids: Math.min(DEFAULT_LIMITS.pids, requested.pids),
  };
  if (![bounds.timeoutMs, bounds.outputBytes, bounds.memoryMb, bounds.cpuCount, bounds.pids].every(value => Number.isFinite(value) && value > 0)) throw Object.assign(new Error("executor limits must be positive numbers"), { code: "INVALID_EXECUTOR_LIMITS" });
  const source = String(stagingPath).replaceAll("\\", "/");
  if (source.includes(",") || source.includes("\n") || source.includes("\r")) throw Object.assign(new Error("staging path contains unsupported mount characters"), { code: "INVALID_STAGING_PATH" });
  return {
    args: ["run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      `--pids-limit=${Math.floor(bounds.pids)}`, `--cpus=${bounds.cpuCount}`, `--memory=${Math.floor(bounds.memoryMb)}m`,
      "--user=65534:65534", "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m",
      "--mount", `type=bind,source=${source},target=/workspace,readonly`, "--workdir", "/workspace", imageDigest, ...command],
    limits: bounds,
  };
}

export function createDockerExecutor({ spawn = nodeSpawn } = {}) {
  return {
    async available() {
      try {
        const result = await runProcess(spawn, "docker", ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 2_000, outputBytes: 1_024 });
        return result.status === "completed";
      } catch { return false; }
    },
    async run({ stagingPath, imageDigest, command, limits = {} }) {
      const built = dockerArguments({ stagingPath, imageDigest, command, limits });
      const image = await runProcess(spawn, "docker", ["image", "inspect", imageDigest], { timeoutMs: 2_000, outputBytes: 1_024 }).catch(() => null);
      if (image?.status !== "completed") return { status: "unavailable", stdout: "", stderr: "", diagnostics: ["Pinned Docker image is not available locally; automatic pull is disabled."], durationMs: image?.durationMs ?? 0 };
      return runProcess(spawn, "docker", built.args, { timeoutMs: built.limits.timeoutMs, outputBytes: built.limits.outputBytes });
    },
  };
}
