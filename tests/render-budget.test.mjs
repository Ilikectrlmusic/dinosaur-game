import { test } from "node:test";
import assert from "node:assert/strict";
import { RenderBudget } from "../src/render-budget.js";

function run(budget, fps, seconds) {
  let changes = 0;
  for (let i = 0; i < seconds * fps; i++) if (budget.sample(1 / fps)) changes++;
  return changes;
}

test("60/120 Hz rendering and isolated stalls keep full visual resolution", () => {
  for (const fps of [60, 120]) {
    const budget = new RenderBudget(); budget.reset(1.5, 0.8);
    assert.equal(run(budget, fps, 20), 0);
    for (let i = 0; i < 5; i++) { budget.sample(0.2); run(budget, fps, 4); }
    assert.equal(budget.ratio, 1.5);
  }
});

test("sustained slow frames reduce GPU work within a bounded range and recover gradually", () => {
  const budget = new RenderBudget(); budget.reset(1.65, 0.8);
  const changes = run(budget, 30, 20);
  assert.ok(changes >= 3 && changes <= 6);
  assert.equal(budget.ratio, 0.8);
  assert.equal(run(budget, 15, 10), 0);
  run(budget, 60, 4);
  assert.equal(budget.ratio, 0.8);
  run(budget, 60, 8);
  assert.ok(budget.ratio > 0.8 && budget.ratio < 1);
  run(budget, 120, 180);
  assert.equal(budget.ratio, 1.65);
});

test("pause and quality changes discard timing history without changing the selected ceiling", () => {
  const budget = new RenderBudget(); budget.reset(1, 0.7);
  run(budget, 30, 8);
  const ratio = budget.ratio;
  budget.resetTiming();
  assert.equal(run(budget, 30, 1), 0);
  assert.equal(budget.ratio, ratio);
  budget.reset(1.5, 0.8);
  assert.equal(budget.ratio, 1.5);
  assert.equal(run(budget, 60, 10), 0);
});
