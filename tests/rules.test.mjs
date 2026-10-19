import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG, GRAVITY, JUMP_VELOCITY, CACTUS_HEIGHTS, BIRD_HEIGHTS,
  BIRD_BOB, BIRD_SPEED_BONUS, overlapsRunner, advanceJump,
  speedAtTime, chooseObstacle, spawnDelay,
  CACTUS_CLUSTER_DISTANCE, CACTUS_CLUSTER_SPACING, BIRD_UNLOCK_DISTANCE,
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

test("birds and triple cacti unlock in stages after the opening cactus jumps", () => {
  let seed = 7321;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const distance of [0, 40, BIRD_UNLOCK_DISTANCE - 0.01]) for (let i = 0; i < 100; i++) {
    const obstacle = chooseObstacle(distance, random);
    assert.equal(obstacle.type, "cactus");
    assert.notEqual(obstacle.variant, "triple");
  }
  assert.equal(chooseObstacle(BIRD_UNLOCK_DISTANCE, () => 0).type, "bird");
  const middle = new Set();
  for (let i = 0; i < 100; i++) {
    const obstacle = chooseObstacle(CACTUS_CLUSTER_DISTANCE - 0.01, random);
    assert.notEqual(obstacle.variant, "triple");
    middle.add(obstacle.type);
  }
  assert.ok(middle.has("bird"));
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const obstacle = chooseObstacle(200 + i * 20, random);
    seen.add(`${obstacle.type}:${obstacle.variant}`);
    if (obstacle.type === "bird") assert.equal(obstacle.flightHeight, BIRD_HEIGHTS[obstacle.variant]);
    else if (obstacle.variant === "triple") {
      assert.ok(obstacle.members.every((member) => member.height === obstacle.height));
      assert.equal(obstacle.members.length, 3);
      assert.deepEqual(obstacle.members.map((member) => member.z), [0, -CACTUS_CLUSTER_SPACING, -2 * CACTUS_CLUSTER_SPACING]);
    } else assert.equal(obstacle.height, CACTUS_HEIGHTS[obstacle.variant]);
  }
  assert.deepEqual([...seen].sort(), ["bird:high", "bird:low", "cactus:medium", "cactus:small", "cactus:tall", "cactus:triple"]);
});

test("triple cacti have a narrower but reachable jump window at every unlocked speed and difficulty", () => {
  const members = [0, 1, 2].map((i) => ({ x: 0, z: -i * CACTUS_CLUSTER_SPACING, height: CACTUS_HEIGHTS.tall }));
  const triple = { ...cactus, height: CACTUS_HEIGHTS.tall, members };
  for (const [difficulty, config] of Object.entries(CONFIG)) {
    const unlockSpeed = Math.min(config.maxSpeed, Math.sqrt(config.speed ** 2 + 2 * config.acceleration * CACTUS_CLUSTER_DISTANCE));
    for (let speed = unlockSpeed; speed < config.maxSpeed + 0.249; speed += 0.25) {
      speed = Math.min(speed, config.maxSpeed);
      const distanceAt = (t) => {
        const accelerating = Math.min(t, (config.maxSpeed - speed) / config.acceleration);
        return speed * accelerating + config.acceleration * accelerating ** 2 / 2 + config.maxSpeed * (t - accelerating);
      };
      const clears = (lead, obstacle, dt = 1 / 240) => {
        for (let t = 0; t < 1.25; t += dt) {
          const y = Math.max(0, JUMP_VELOCITY * t - GRAVITY * t * t / 2);
          if (overlapsRunner({ ...runner, y }, { ...obstacle, z: distanceAt(t) - distanceAt(lead) })) return false;
        }
        return true;
      };
      const allowed = [], single = [];
      for (let lead = 0.2; lead < 0.8; lead += 0.005) {
        if (clears(lead, triple)) allowed.push(lead);
        if (clears(lead, { ...triple, members: undefined })) single.push(lead);
      }
      assert.ok(allowed.at(-1) - allowed[0] >= 0.17, `${difficulty} at ${speed}: leave a usable timing window`);
      assert.ok(allowed.length < single.length, "the full group should demand more precise timing than one tall cactus");
      for (const dt of [1 / 30, 1 / 60, 1 / 120]) assert.ok(clears(0.42, triple, dt));
      assert.equal(clears(0.15, triple), false, "jumping too late must hit the first cactus");
      assert.equal(clears(0.8, triple), false, "landing in the group must hit a trailing cactus");
      if (speed === config.maxSpeed) break;
    }
  }
});

test("the last cactus remains lethal after the first two have passed", () => {
  const members = [0, 1, 2].map((i) => ({ x: 0, z: -i * CACTUS_CLUSTER_SPACING, height: 2.05 }));
  assert.equal(overlapsRunner(runner, { ...cactus, z: 2.1, members }), true);
  assert.equal(overlapsRunner(runner, { ...cactus, z: 3.1, members }), false);
});

test("a faster bird behind a single or triple cactus leaves time to land and duck throughout acceleration", () => {
  for (const [difficulty, config] of Object.entries(CONFIG)) {
    for (let speed = config.speed; speed <= config.maxSpeed; speed += 0.25) for (const depth of [0, 2 * CACTUS_CLUSTER_SPACING]) {
      const gap = spawnDelay(difficulty, speed, () => 0, depth);
      const distanceAt = (time) => {
        const accelerating = Math.min(time, (config.maxSpeed - speed) / config.acceleration);
        return speed * accelerating + config.acceleration * accelerating ** 2 / 2 + config.maxSpeed * (time - accelerating);
      };
      const arrival = (distance, target = 95) => {
        let from = 0, to = 20;
        for (let i = 0; i < 40; i++) {
          const middle = (from + to) / 2;
          if (distance(middle) < target) from = middle;
          else to = middle;
        }
        return to;
      };
      const cactusArrival = arrival(distanceAt, 95 + depth);
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
