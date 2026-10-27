import test from "node:test";
import assert from "node:assert/strict";
import { DAY_NIGHT_SECONDS, START_DAY_PHASE, sampleDayNight } from "../src/day-night.js";

test("the sun, daylight and torch repeat continuously through dawn, day, dusk and night", () => {
  const stages = new Set();
  for (let t = 0; t < DAY_NIGHT_SECONDS; t += 0.1) {
    const a = sampleDayNight(t), b = sampleDayNight(t + DAY_NIGHT_SECONDS * 100);
    stages.add(a.stage);
    for (const key of ["sunX", "sunY", "sunZ", "daylight", "solar", "night", "twilight", "torch"])
      assert.ok(Math.abs(a[key] - b[key]) < 1e-10, key);
    assert.ok(Math.abs(Math.hypot(a.sunX, a.sunY, a.sunZ) - 1) < 1e-12);
    for (const key of ["daylight", "solar", "night", "twilight", "torch"]) assert.ok(a[key] >= 0 && a[key] <= 1);
    const next = sampleDayNight(t + 1 / 120);
    for (const key of ["sunX", "sunY", "sunZ", "daylight", "night", "torch"])
      assert.ok(Math.abs(a[key] - next[key]) < 0.01, `${key} must not pop between frames`);
  }
  assert.deepEqual(stages, new Set(["day", "golden-hour", "sunset", "blue-hour", "night", "sunrise"]));
  const dusk = sampleDayNight((0.75 - START_DAY_PHASE) * DAY_NIGHT_SECONDS);
  const dawn = sampleDayNight((1.25 - START_DAY_PHASE) * DAY_NIGHT_SECONDS);
  assert.ok(Math.abs(dusk.sunY) < 1e-12 && Math.abs(dawn.sunY) < 1e-12);
  assert.equal(dusk.rising, false); assert.equal(dawn.rising, true);
  const midnight = sampleDayNight((1 - START_DAY_PHASE) * DAY_NIGHT_SECONDS);
  assert.equal(midnight.torch, 1); assert.equal(midnight.solar, 0); assert.equal(midnight.night, 1);
  assert.equal(sampleDayNight(0).torch, 0);
});

test("cycle sampling reuses its state and is independent of frame rate and obstacle randomness", () => {
  const state = {}, original = Math.random;
  Math.random = () => { throw new Error("daylight must not change obstacle randomness"); };
  try {
    for (const fps of [30, 60, 120]) {
      let elapsed = 0;
      for (let i = 0; i < fps * 30; i++) elapsed += 1 / fps;
      assert.equal(sampleDayNight(elapsed, state), state);
      assert.ok(Math.abs(state.sunY - sampleDayNight(30).sunY) < 1e-11);
    }
  } finally { Math.random = original; }
});
