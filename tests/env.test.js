import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadEnvFile } from "../src/env.js";

test("loads dotenv-style values without overriding existing env", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "market-env-"));
  const env = { FINNHUB_API_KEY: "already-set" };

  try {
    const filePath = path.join(dir, ".env.local");
    writeFileSync(filePath, [
      "ALPHA_VANTAGE_API_KEY=alpha-key",
      "FINNHUB_API_KEY=file-key",
      "TELEGRAM_TOPIC_MAP='{\"BTCUSDT\":3}'",
      "# ignored comment"
    ].join("\n"));

    const loaded = loadEnvFile({ filePath, env });

    assert.equal(loaded, true);
    assert.equal(env.ALPHA_VANTAGE_API_KEY, "alpha-key");
    assert.equal(env.FINNHUB_API_KEY, "already-set");
    assert.equal(env.TELEGRAM_TOPIC_MAP, "{\"BTCUSDT\":3}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
