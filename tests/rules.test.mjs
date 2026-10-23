import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG, GRAVITY, JUMP_VELOCITY, CACTUS_HEIGHTS, BIRD_HEIGHTS,
  BIRD_BOB, BIRD_SPEED_BONUS, overlapsRunner, advanceJump,
  speedAtTime, chooseObstacle, spawnDelay,
  CACTUS_CLUSTER_DISTANCE, CACTUS_CLUSTER_SPACING, BIRD_UNLOCK_DISTANCE,
  CACTUS_CLUSTER_PATTERNS,
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
    assert.ok(speeds[1] > speeds[0] + 1);
    assert.ok(speeds[1] < speeds[0] + CONFIG[difficulty].acceleration * 10);
    assert.ok(speeds[2] > speeds[1]);
    assert.ok(speeds.every((speed, i) => !i || speed >= speeds[i - 1]));
    assert.equal(speeds.at(-1), CONFIG[difficulty].maxSpeed);
    assert.ok(speedAtTime(difficulty, 80) - speedAtTime(difficulty, 60) < speedAtTime(difficulty, 20) - speedAtTime(difficulty, 0), "later acceleration should be gentler");
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

test("all single cactus heights can appear from the start; birds and triples unlock later", () => {
  let seed = 7321;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const distance of [0, 40, BIRD_UNLOCK_DISTANCE - 0.01]) {
    const heights = new Set();
    for (let i = 0; i < 100; i++) {
      const obstacle = chooseObstacle(distance, random);
      assert.equal(obstacle.type, "cactus");
      assert.notEqual(obstacle.variant, "triple");
      heights.add(obstacle.height);
    }
    assert.deepEqual([...heights].sort(), Object.values(CACTUS_HEIGHTS).sort());
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
      assert.equal(new Set(obstacle.members.map((member) => member.height)).size, 3);
      assert.equal(Math.max(...obstacle.members.map((member) => member.height)), obstacle.height);
      assert.equal(obstacle.members.length, 3);
      assert.deepEqual(obstacle.members.map((member) => member.z), [0, -CACTUS_CLUSTER_SPACING, -2 * CACTUS_CLUSTER_SPACING]);
    } else assert.equal(obstacle.height, CACTUS_HEIGHTS[obstacle.variant]);
  }
  assert.deepEqual([...seen].sort(), ["bird:high", "bird:low", "cactus:medium", "cactus:small", "cactus:tall", "cactus:triple"]);
});

test("all staggered cactus patterns remain jumpable at every unlocked speed and difficulty", () => {
  for (const [difficulty, config] of Object.entries(CONFIG)) {
    let unlockTime = 0, distance = 0;
    while (distance < CACTUS_CLUSTER_DISTANCE) {
      unlockTime += 1 / 240;
      distance += speedAtTime(difficulty, unlockTime) / 240;
    }
    const unlockSpeed = speedAtTime(difficulty, unlockTime);
    for (const heights of CACTUS_CLUSTER_PATTERNS) {
      const members = heights.map((height, i) => ({ x: 0, z: -i * CACTUS_CLUSTER_SPACING, height }));
      const triple = { ...cactus, height: CACTUS_HEIGHTS.tall, members };
      for (let speed = unlockSpeed; speed < config.maxSpeed + 0.499; speed += 0.5) {
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
          if (clears(lead, { ...triple, members: [members.find((member) => member.height === triple.height)] })) single.push(lead);
        }
        assert.ok(allowed.at(-1) - allowed[0] >= 0.17, `${difficulty} at ${speed}: leave a usable timing window`);
        assert.ok(allowed.length <= single.length, "the tall cactus must still constrain the timing within the group");
        for (const dt of [1 / 30, 1 / 60, 1 / 120]) assert.ok(clears(0.42, triple, dt));
        assert.equal(clears(0.05, triple), false, "jumping at the first cactus must still be too late");
        assert.equal(clears(0.9, triple), false, "landing in the group must hit a trailing cactus");
        if (speed === config.maxSpeed) break;
      }
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

test("cactus tips and individual arms respect visible clearance instead of a full-height box", () => {
  const box = (x, y, z, radius = 0.03) => ({ min: { x: x - radius, y: y - radius, z: z - radius }, max: { x: x + radius, y: y + radius, z: z + radius } });
  const contact = (bounds) => overlapsRunner({ ...runner, cactusBounds: [bounds] }, { ...cactus, height: 1.55 });
  assert.equal(contact(box(0, 1.6, 0)), false, "clear above the visible tip");
  assert.equal(contact(box(0, 1.48, 0)), true, "touching the trunk is lethal");
  assert.equal(contact(box(0.5, 1.53, 0)), false, "empty space over the shorter side arm is safe");
  assert.equal(contact(box(0.5, 1.38, 0)), true, "touching the actual side arm is lethal");
  assert.equal(contact(box(0.17, 1.53, 0)), false, "rounded cap does not occupy its outer bounding corner");
  assert.equal(contact(box(0.59, 0.79, 0, 0.005)), false, "rounded elbow leaves its old square outer corner empty");
  assert.equal(contact(box(0.46, 0.9, 0, 0.015)), true, "the continuous curved elbow still collides");
});
