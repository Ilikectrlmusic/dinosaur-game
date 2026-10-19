import { test } from "node:test";
import assert from "node:assert/strict";
import { overlapsRunner, advanceJump, JUMP_VELOCITY } from "../src/rules.js";
const runner = { x: 0, y: 0, duck: 0 },
  cactus = { type: "cactus", x: 0, z: 0, height: 1.65, y: 0 },
  bird = { type: "bird", x: 0, z: 0, y: 3.55 };
test("a grounded runner hits a cactus, while a sufficient jump clears it", () => {
  assert.equal(overlapsRunner(runner, cactus), true);
  assert.equal(overlapsRunner({ ...runner, y: 1.8 }, cactus), false);
  assert.equal(overlapsRunner(runner, { ...cactus, z: -3 }), false);
});
test("ducking clears a low pterosaur; jumping into it does not", () => {
  assert.equal(overlapsRunner(runner, bird), true);
  assert.equal(overlapsRunner({ ...runner, duck: 1 }, bird), false);
  assert.equal(overlapsRunner({ ...runner, y: 2 }, bird), true);
});
test("jump height is physically consistent at 30 and 120 FPS, and landing clamps to the ground", () => {
  const simulate = (dt) => {
    let y = 0,
      vy = JUMP_VELOCITY,
      max = 0,
      landed = false;
    for (let t = 0; t < 1.5; t += dt) {
      const step = advanceJump(y, vy, dt);
      y = step.y;
      vy = step.vy;
      max = Math.max(y, max);
      landed ||= step.landed;
    }
    return { y, vy, max, landed };
  };
  const slow = simulate(1 / 30),
    fast = simulate(1 / 120);
  assert.ok(slow.max > 2.49 && slow.max < 2.51);
  assert.ok(Math.abs(slow.max - fast.max) < 0.01);
  assert.equal(slow.y, 0);
  assert.equal(slow.vy, 0);
  assert.equal(slow.landed, true);
});
test("collisions respect the obstacle footprint and exclude distant objects", () => {
  for (const z of [-40, -2, 2, 40])
    assert.equal(overlapsRunner(runner, { ...cactus, z }), false);
  assert.equal(overlapsRunner({ ...runner, x: 0.7 }, cactus), true);
  assert.equal(overlapsRunner({ ...runner, x: 1.5 }, cactus), false);
});
