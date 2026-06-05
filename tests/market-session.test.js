import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyUsMarketSession,
  decisionIntervalForUsMarketSession
} from "../src/market-session.js";

test("classifies US market sessions using New York time", () => {
  assert.equal(classifyUsMarketSession(new Date("2026-06-04T14:00:00Z")).session, "regular");
  assert.equal(classifyUsMarketSession(new Date("2026-06-04T11:30:00Z")).session, "near_open");
  assert.equal(classifyUsMarketSession(new Date("2026-06-04T12:30:00Z")).session, "near_open");
  assert.equal(classifyUsMarketSession(new Date("2026-06-04T10:00:00Z")).session, "premarket");
  assert.equal(classifyUsMarketSession(new Date("2026-06-04T21:00:00Z")).session, "after_hours");
  assert.equal(classifyUsMarketSession(new Date("2026-06-05T02:00:00Z")).session, "off_hours");
  assert.equal(classifyUsMarketSession(new Date("2026-06-06T14:00:00Z")).session, "weekend");
});

test("uses faster decision intervals during active US stock sessions", () => {
  assert.equal(decisionIntervalForUsMarketSession({
    now: new Date("2026-06-04T14:00:00Z")
  }).intervalMs, 900000);
  assert.equal(decisionIntervalForUsMarketSession({
    now: new Date("2026-06-04T12:30:00Z")
  }).intervalMs, 1800000);
  assert.equal(decisionIntervalForUsMarketSession({
    now: new Date("2026-06-04T10:00:00Z")
  }).intervalMs, 3600000);
  assert.equal(decisionIntervalForUsMarketSession({
    now: new Date("2026-06-04T21:00:00Z")
  }).intervalMs, 3600000);
  assert.equal(decisionIntervalForUsMarketSession({
    now: new Date("2026-06-05T02:00:00Z")
  }).intervalMs, 14400000);
  assert.equal(decisionIntervalForUsMarketSession({
    now: new Date("2026-06-06T14:00:00Z")
  }).intervalMs, 14400000);
});

test("can fall back to a fixed interval when market-aware scheduling is disabled", () => {
  const schedule = decisionIntervalForUsMarketSession({
    now: new Date("2026-06-04T14:00:00Z"),
    scheduleEnabled: false,
    fixedIntervalMs: 420000
  });

  assert.equal(schedule.session, "fixed");
  assert.equal(schedule.intervalMs, 420000);
});

test("aligns market-aware decisions to fixed New York clock boundaries", () => {
  const nearOpen = decisionIntervalForUsMarketSession({
    now: new Date("2026-06-04T11:17:10Z")
  });
  assert.equal(nearOpen.session, "near_open");
  assert.equal(nearOpen.intervalMs, 1800000);
  assert.equal(nearOpen.delayMs, 770000);
  assert.equal(nearOpen.nextRunAt, "2026-06-04T11:30:00.000Z");

  const regular = decisionIntervalForUsMarketSession({
    now: new Date("2026-06-04T13:37:20Z")
  });
  assert.equal(regular.session, "regular");
  assert.equal(regular.intervalMs, 900000);
  assert.equal(regular.delayMs, 460000);
  assert.equal(regular.nextRunAt, "2026-06-04T13:45:00.000Z");

  const offHours = decisionIntervalForUsMarketSession({
    now: new Date("2026-06-04T05:10:00Z")
  });
  assert.equal(offHours.session, "off_hours");
  assert.equal(offHours.intervalMs, 14400000);
  assert.equal(offHours.delayMs, 10200000);
  assert.equal(offHours.nextRunAt, "2026-06-04T08:00:00.000Z");
});
