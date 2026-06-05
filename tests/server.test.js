import assert from "node:assert/strict";
import test from "node:test";

import { createTickerStore } from "../src/market.js";
import { createHttpServer, displayLongTermRegimeForSymbol } from "../src/server.js";

async function withServer(server, callback) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint reports service status", async () => {
  const store = createTickerStore();
  const server = createHttpServer({
    tickerStore: store,
    startMarketStream: false,
    startStooqPoller: false,
    startDecisionEngine: false,
    startTelegramCommands: false
  });

  await withServer(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.tickers, 0);
  });
});

test("health endpoint reports the market-aware decision schedule", async () => {
  const store = createTickerStore();
  const server = createHttpServer({
    tickerStore: store,
    startMarketStream: false,
    startStooqPoller: false,
    startDecisionEngine: false,
    startTelegramCommands: false,
    decisionNow: () => new Date("2026-06-04T14:00:00Z"),
    decisionScheduleConfig: {
      scheduleEnabled: true,
      fixedIntervalMs: 300000,
      intervals: {
        regular: 111000
      }
    }
  });

  await withServer(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.decisionSchedule.session, "regular");
    assert.equal(body.decisionSchedule.label, "美股盘中");
    assert.equal(body.decisionSchedule.intervalMs, 111000);
    assert.equal(body.opportunityScanSchedule.session, "regular");
    assert.equal(body.opportunityScanSchedule.intervalMs, 300000);
  });
});

test("tickers endpoint returns current store snapshot", async () => {
  const store = createTickerStore();
  store.applyMiniTickerArray([
    { s: "BTCUSDT", c: "69000", o: "68000", h: "70000", l: "67000", v: "10", q: "690000", E: 2 }
  ]);

  const server = createHttpServer({
    tickerStore: store,
    startMarketStream: false,
    startStooqPoller: false,
    startDecisionEngine: false,
    startTelegramCommands: false
  });

  await withServer(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickers`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.tickers[0].symbol, "BTCUSDT");
  });
});

test("display long-term regime uses routed topic symbol and keeps source symbol", () => {
  const regime = displayLongTermRegimeForSymbol({
    sourceSymbol: "XAUUSDT",
    displaySymbol: "XAUUSD",
    regime: {
      symbol: "XAUUSDT",
      regime: "bull",
      biasDirection: "LONG",
      note: "XAUUSDT 日线处于牛市结构，回撤优先找多头性价比。"
    }
  });

  assert.equal(regime.symbol, "XAUUSD");
  assert.equal(regime.sourceSymbol, "XAUUSDT");
  assert.ok(regime.note.includes("XAUUSD 日线"));
  assert.equal(regime.note.includes("XAUUSDT 日线"), false);
});
