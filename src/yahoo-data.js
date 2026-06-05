import { spawn } from "node:child_process";
import path from "node:path";

function enabled(value) {
  return !["0", "false", "no", "off"].includes(String(value ?? "false").trim().toLowerCase());
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) return null;

  for (const line of trimmed.split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // yfinance can emit warnings before JSON; keep looking for the payload.
    }
  }

  return null;
}

function commandParts({ symbol, interval, limit }) {
  const script = process.env.YAHOO_DATA_SCRIPT
    ?? path.join(process.cwd(), "scripts", "yahoo_feed.py");
  const python = process.env.YAHOO_PYTHON
    ?? process.env.MODEL_BRAIN_PYTHON
    ?? process.env.TRADINGVIEW_PYTHON
    ?? "python3";

  return {
    cmd: python,
    args: [
      script,
      "--symbol", symbol,
      "--interval", interval,
      "--limit", String(limit)
    ]
  };
}

export async function fetchYahooCandles({
  symbol,
  interval = "1h",
  limit = 120,
  enabledFlag = process.env.YAHOO_DATA_ENABLED,
  timeoutMs = Number(process.env.YAHOO_DATA_TIMEOUT_MS ?? 10000)
} = {}) {
  if (!enabled(enabledFlag)) {
    return { ok: false, skipped: true, reason: "yahoo_disabled" };
  }

  const { cmd, args } = commandParts({ symbol, interval, limit });

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
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
      finish({ ok: false, error: "yahoo_timeout" });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, error: error.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const parsed = parseJsonOutput(stdout);
      if (!parsed?.ok || !Array.isArray(parsed.candles)) {
        finish({ ok: false, error: parsed?.error ?? stderr.trim() ?? "yahoo_no_data" });
        return;
      }

      parsed.candles.dataSource = {
        provider: parsed.provider ?? "Yahoo Finance",
        exchange: parsed.exchange ?? "Yahoo",
        reference: parsed.reference ?? "chart",
        quoteSymbol: parsed.symbol ?? symbol,
        interval
      };
      finish({
        ok: true,
        symbol,
        candles: parsed.candles,
        dataSource: parsed.candles.dataSource
      });
    });
  });
}
