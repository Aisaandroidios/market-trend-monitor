import assert from "node:assert/strict";
import test from "node:test";

import {
  binanceSymbolForTopicSymbol,
  displaySymbolForBinanceSymbol,
  decisionSymbolsWithBinanceAliases
} from "../src/binance-aliases.js";

test("maps gold topic symbols to Binance futures gold pairs", () => {
  assert.equal(binanceSymbolForTopicSymbol("XAUUSD"), "XAUUSDT");
  assert.equal(binanceSymbolForTopicSymbol("GOLD"), "XAUUSDT");
  assert.equal(binanceSymbolForTopicSymbol("GLD"), "XAUUSDT");
  assert.equal(binanceSymbolForTopicSymbol("PAXGUSDT"), "PAXGUSDT");
});

test("maps Binance futures stock topics and oil aliases", () => {
  assert.equal(binanceSymbolForTopicSymbol("QQQUSDT"), "QQQUSDT");
  assert.equal(binanceSymbolForTopicSymbol("NVDAUSDT"), "NVDAUSDT");
  assert.equal(binanceSymbolForTopicSymbol("INTCUSDT"), "INTCUSDT");
  assert.equal(binanceSymbolForTopicSymbol("APPLE"), "AAPLUSDT");
  assert.equal(binanceSymbolForTopicSymbol("OIL"), "CLUSDT");
  assert.equal(binanceSymbolForTopicSymbol("WTIOIL-USDC"), "CLUSDT");
  assert.equal(binanceSymbolForTopicSymbol("USO"), null);
});

test("maps Hyperliquid USDC topic aliases to candle request symbols", () => {
  assert.equal(binanceSymbolForTopicSymbol("NVDA-USDC"), "NVDAUSDT");
  assert.equal(binanceSymbolForTopicSymbol("HYPE-USDC"), "HYPEUSDT");
  assert.equal(binanceSymbolForTopicSymbol("XYZ100-USDC"), "XYZ100USDT");
  assert.equal(binanceSymbolForTopicSymbol("S&P500-USDC"), "SP500USDT");
  assert.equal(binanceSymbolForTopicSymbol("SILVER-USDC"), "SILVERUSDT");
  assert.equal(binanceSymbolForTopicSymbol("BRENTOIL-USDC"), "BRENTOILUSDT");
});

test("maps newly added Telegram topics to candle request symbols", () => {
  assert.equal(binanceSymbolForTopicSymbol("MSFT USDT"), "MSFTUSDT");
  assert.equal(binanceSymbolForTopicSymbol("SNDK USDT"), "SNDKUSDT");
  assert.equal(binanceSymbolForTopicSymbol("NOW USDT"), "NOWUSDT");
  assert.equal(binanceSymbolForTopicSymbol("TSLA USDT"), "TSLAUSDT");
  assert.equal(binanceSymbolForTopicSymbol("ORCL USDT"), "ORCLUSDT");
  assert.equal(binanceSymbolForTopicSymbol("AMD USDT"), "AMDUSDT");
  assert.equal(binanceSymbolForTopicSymbol("GOOG USDT"), "GOOGLUSDT");
  assert.equal(binanceSymbolForTopicSymbol("META USDT"), "METAUSDT");
  assert.equal(binanceSymbolForTopicSymbol("CRCL USDT"), "CRCLUSDT");
  assert.equal(binanceSymbolForTopicSymbol("SPCX USDT"), "SPCXUSDT");
  assert.equal(binanceSymbolForTopicSymbol("DELL USDT"), "DELLUSDT");
  assert.equal(binanceSymbolForTopicSymbol("SMCI USDT"), null);
  assert.equal(binanceSymbolForTopicSymbol("QCOM USDT"), "QCOMUSDT");
  assert.equal(binanceSymbolForTopicSymbol("MSTR USDT"), "MSTRUSDT");
  assert.equal(binanceSymbolForTopicSymbol("WMT USDT"), "WMTUSDT");
  assert.equal(binanceSymbolForTopicSymbol("MCD USDT"), null);
  assert.equal(binanceSymbolForTopicSymbol("BZ USDT"), "BRENTOILUSDT");
  assert.equal(binanceSymbolForTopicSymbol("SOXL USDT"), "SOXLUSDT");
  assert.equal(binanceSymbolForTopicSymbol("EWY USDT"), "EWYUSDT");
  assert.equal(binanceSymbolForTopicSymbol("COIN USDT"), "COINUSDT");
});

test("adds Binance aliases for supported topic symbols", () => {
  const symbols = decisionSymbolsWithBinanceAliases({
    topicMap: { BTCUSDT: 3, XAUUSD: 13, QQQUSDT: 5, "CL.F": 14 },
    baseSymbols: ["BTCUSDT", "ETHUSDT"]
  });

  assert.deepEqual(symbols, ["BTCUSDT", "ETHUSDT", "XAUUSDT", "QQQUSDT", "CLUSDT"]);
});

test("displays Binance gold aliases as the requested market", () => {
  assert.equal(displaySymbolForBinanceSymbol("XAUUSDT"), "XAUUSD");
  assert.equal(displaySymbolForBinanceSymbol("SILVERUSDT"), "XAGUSD");
  assert.equal(displaySymbolForBinanceSymbol("CLUSDT"), "CL.F");
  assert.equal(displaySymbolForBinanceSymbol("BRENTOILUSDT"), "BZUSDT");
  assert.equal(displaySymbolForBinanceSymbol("GOOGLUSDT"), "GOOGUSDT");
  assert.equal(displaySymbolForBinanceSymbol("BTCUSDT"), "BTCUSDT");
});
