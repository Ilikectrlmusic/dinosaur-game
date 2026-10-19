import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG, GRAVITY, JUMP_VELOCITY, CACTUS_HEIGHTS, BIRD_HEIGHTS,
  BIRD_BOB, BIRD_SPEED_BONUS, overlapsRunner, advanceJump,
  speedAtTime, chooseObstacle, spawnDelay,
} from "../src/rules.js";
const runner = { x: 0, y: 0, duck: 0 },
  cactus = { type: "cactus", x: 0, z: 0, height: 1.65, y: 0 },
  bird = { type: "bird", x: 0, z: 0, y: 3.55 };
test("a grounded runner hits a cactus, while a sufficient jump clears it", () => {
  assert.equal(overlapsRunner(runner, cactus), true);
  assert.equal(overlapsRunner({ ...runner, y: 1.8 }, cactus), false);
  assert.equal(overlapsRunner(runner, { ...cactus, z: -3 }), false);
});
test("ducking clears the high pterosaur; jumping into it does not", () => {
  assert.equal(overlapsRunner(runner, bird), true);
  assert.equal(overlapsRunner({ ...runner, duck: 1 }, bird), false);
  assert.equal(overlapsRunner({ ...runner, y: 2 }, bird), true);
});

test("all three difficulties visibly accelerate, remain monotonic and stop at a playable speed cap", () => {
  for (const difficulty of Object.keys(CONFIG)) {
    const speeds = [0, 10, 20, 40, 60, 120, 1000].map((t) => speedAtTime(difficulty, t));
    assert.ok(speeds[1] >= speeds[0] + 2);
    assert.ok(speeds[2] > speeds[1]);
    assert.ok(speeds.every((speed, i) => !i || speed >= speeds[i - 1]));
    assert.equal(speeds.at(-1), CONFIG[difficulty].maxSpeed);
    assert.ok(spawnDelay(difficulty, speeds.at(-1), () => 0) < spawnDelay(difficulty, speeds[0], () => 0));
  }
});

test("every cactus height is lethal on the ground and can be cleared for the whole collision window", () => {
  assert.ok(Math.max(...Object.values(CACTUS_HEIGHTS)) - Math.min(...Object.values(CACTUS_HEIGHTS)) > 0.99);
  for (const height of Object.values(CACTUS_HEIGHTS)) {
    const obstacle = { ...cactus, height };
    assert.equal(overlapsRunner(runner, obstacle), true);
    assert.equal(overlapsRunner({ ...runner, duck: 1 }, obstacle), true);
    for (const speed of [10, 19, 24, 30, 36]) {
      for (let t = 0; t < 1.1; t += 1 / 240) {
        const y = Math.max(0, JUMP_VELOCITY * t - GRAVITY * t * t / 2);
        assert.equal(overlapsRunner({ ...runner, y }, { ...obstacle, z: (t - 0.45) * speed }), false);
      }
    }
  }
});

test("low birds require jumping and high birds require ducking, including both ends of their flight bob", () => {
  const apex = JUMP_VELOCITY ** 2 / (2 * GRAVITY);
  for (const bob of [-BIRD_BOB, 0, BIRD_BOB]) {
    const low = { ...bird, y: BIRD_HEIGHTS.low + bob };
    const high = { ...bird, y: BIRD_HEIGHTS.high + bob };
    assert.equal(overlapsRunner(runner, low), true);
    assert.equal(overlapsRunner({ ...runner, duck: 1 }, low), true);
    assert.equal(overlapsRunner({ ...runner, y: apex }, low), false);
    assert.equal(overlapsRunner(runner, high), true);
    assert.equal(overlapsRunner({ ...runner, y: apex }, high), true);
    assert.equal(overlapsRunner({ ...runner, duck: 1 }, high), false);
    for (const speed of [10, 19, 24, 30, 36]) {
      for (let t = 0; t < 1.1; t += 1 / 240) {
        const y = Math.max(0, JUMP_VELOCITY * t - GRAVITY * t * t / 2);
        const z = (t - 0.45) * (speed + BIRD_SPEED_BONUS);
        assert.equal(overlapsRunner({ ...runner, y }, { ...low, z }), false);
        assert.equal(overlapsRunner({ ...runner, duck: 1 }, { ...high, z }), false);
      }
    }
  }
});

test("the opening teaches cactus jumps and later runs contain all five obstacle variants", () => {
  let seed = 7321;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 50; i++) assert.equal(chooseObstacle(40, random).type, "cactus");
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const obstacle = chooseObstacle(200 + i * 20, random);
    seen.add(`${obstacle.type}:${obstacle.variant}`);
    if (obstacle.type === "bird") assert.equal(obstacle.flightHeight, BIRD_HEIGHTS[obstacle.variant]);
    else assert.equal(obstacle.height, CACTUS_HEIGHTS[obstacle.variant]);
  }
  assert.deepEqual([...seen].sort(), ["bird:high", "bird:low", "cactus:medium", "cactus:small", "cactus:tall"]);
});

test("even a faster bird behind a cactus leaves time to land before ducking throughout acceleration", () => {
  for (const [difficulty, config] of Object.entries(CONFIG)) {
    for (let speed = config.speed; speed <= config.maxSpeed; speed += 0.25) {
      const gap = spawnDelay(difficulty, speed, () => 0);
      const distanceAt = (time) => {
        const accelerating = Math.min(time, (config.maxSpeed - speed) / config.acceleration);
        return speed * accelerating + config.acceleration * accelerating ** 2 / 2 + config.maxSpeed * (time - accelerating);
      };
      const arrival = (distance) => {
        let from = 0, to = 20;
        for (let i = 0; i < 40; i++) {
          const middle = (from + to) / 2;
          if (distance(middle) < 95) from = middle;
          else to = middle;
        }
        return to;
      };
      const cactusArrival = arrival(distanceAt);
      const birdArrival = arrival((time) => distanceAt(time + gap) - distanceAt(gap) + BIRD_SPEED_BONUS * time) + gap;
      assert.ok(birdArrival - cactusArrival > 1.1, `${difficulty} at ${speed} m/s needs more recovery time`);
    }
  }
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
