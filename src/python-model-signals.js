import { spawn } from "node:child_process";
import path from "node:path";

function enabled(value) {
  return !["0", "false", "no", "off"].includes(String(value ?? "false").trim().toLowerCase());
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) return null;

  for (const line of trimmed.split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning because some Python libraries write warnings before JSON.
    }
  }

  return null;
}

function commandParts() {
  const script = process.env.PYTHON_MODEL_BRAIN_SCRIPT
    ?? path.join(process.cwd(), "scripts", "export_model_signals.py");
  const python = process.env.MODEL_BRAIN_PYTHON
    ?? process.env.TRADINGVIEW_PYTHON
    ?? "python3";

  return { cmd: python, args: [script] };
}

function withStatus(map, status) {
  Object.defineProperty(map, "status", {
    value: status,
    enumerable: false,
    configurable: true
  });
  return map;
}

export async function buildPythonModelSignals({
  ideas = [],
  enabledFlag = process.env.PYTHON_MODEL_BRAIN_ENABLED,
  timeoutMs = Number(process.env.PYTHON_MODEL_BRAIN_TIMEOUT_MS ?? 8000)
} = {}) {
  if (!enabled(enabledFlag)) {
    return withStatus(new Map(), { ok: false, skipped: true, reason: "disabled" });
  }
  if (ideas.length === 0) {
    return withStatus(new Map(), { ok: false, skipped: true, reason: "no_ideas" });
  }

  const { cmd, args } = commandParts();
  const input = JSON.stringify({ ideas });

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(withStatus(new Map(), { ok: false, error: "timeout", count: 0 }));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(withStatus(new Map(), { ok: false, error: "spawn_failed", count: 0 }));
    });
    child.on("close", () => {
      clearTimeout(timer);
      const parsed = parseJsonOutput(stdout);
      if (!parsed?.ok || !Array.isArray(parsed.signals)) {
        if (stderr.trim()) {
          // Python model output is optional; bad output should not stop trading scans.
        }
        finish(withStatus(new Map(), {
          ok: false,
          error: parsed?.error ?? "bad_output",
          count: 0
        }));
        return;
      }

      finish(withStatus(new Map(
        parsed.signals
          .map((signal) => [normalizeSymbol(signal.symbol), signal])
          .filter(([symbol]) => symbol)
      ), {
        ok: true,
        provider: parsed.provider ?? "Python Open Quant Brain",
        count: parsed.signals.length,
        runtime: parsed.runtime ?? null
      }));
    });

    child.stdin.end(input);
  });
}
