import { spawn } from "node:child_process";
import path from "node:path";

function enabled(value) {
  return !["0", "false", "no", "off"].includes(String(value ?? "false").trim().toLowerCase());
}

function defaultExchangeForSymbol(symbol) {
  const base = String(symbol ?? "").replace(/USDT$/, "");
  if (["XAUUSD", "XAU", "GLD"].includes(base)) return "OANDA";
  if (["XAGUSD", "XAG"].includes(base)) return "OANDA";
  if (["CL", "CL.F", "USO"].includes(base)) return "NYMEX";
  if (["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "GOOGL", "GOOG", "MCD", "IBM", "DELL", "NOW", "SMCI"].includes(base)) {
    return "NASDAQ";
  }
  return "NASDAQ";
}

function tradingViewSymbol(symbol) {
  const value = String(symbol ?? "").replace(/USDT$/, "");
  const aliases = {
    GOOG: "GOOGL",
    XAU: "XAUUSD",
    XAG: "XAGUSD",
    CLF: "CL1!",
    CL: "CL1!",
    BZ: "BRN1!",
    BRENTOIL: "BRN1!"
  };
  return aliases[value] ?? value;
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const line = trimmed.split(/\r?\n/).at(-1);
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function commandParts({ symbol, interval, limit }) {
  const script = process.env.TRADINGVIEW_DATA_SCRIPT
    ?? path.join(process.cwd(), "scripts", "tradingview_feed.py");
  const python = process.env.TRADINGVIEW_PYTHON ?? "python3";
  const tvSymbol = tradingViewSymbol(symbol);
  const exchange = process.env[`TRADINGVIEW_EXCHANGE_${tvSymbol}`] ?? defaultExchangeForSymbol(tvSymbol);

  return {
    cmd: python,
    args: [
      script,
      "--symbol", tvSymbol,
      "--exchange", exchange,
      "--interval", interval,
      "--limit", String(limit)
    ]
  };
}

export async function fetchTradingViewCandles({
  symbol,
  interval = "1h",
  limit = 120,
  enabledFlag = process.env.TRADINGVIEW_DATA_ENABLED,
  timeoutMs = Number(process.env.TRADINGVIEW_DATA_TIMEOUT_MS ?? 5000)
} = {}) {
  if (!enabled(enabledFlag)) {
    return { ok: false, skipped: true, reason: "tradingview_disabled" };
  }

  const { cmd, args } = commandParts({ symbol, interval, limit });

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, error: "tradingview_timeout" });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const parsed = parseJsonOutput(stdout);
      if (!parsed?.ok || !Array.isArray(parsed.candles)) {
        resolve({ ok: false, error: parsed?.error ?? stderr.trim() ?? "tradingview_no_data" });
        return;
      }

      parsed.candles.dataSource = {
        provider: parsed.provider ?? "TradingView",
        exchange: parsed.exchange ?? "TradingView",
        reference: "tradingview_adapter",
        quoteSymbol: parsed.symbol ?? symbol,
        interval
      };
      resolve({
        ok: true,
        symbol,
        candles: parsed.candles,
        dataSource: parsed.candles.dataSource
      });
    });
  });
}
