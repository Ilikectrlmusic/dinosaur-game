import { test } from "node:test";
import assert from "node:assert/strict";
import { DinosaurGait, solveLeg, LANDING_STEP_DELAY, LANDING_RECOVERY } from "../src/dinosaur-gait.js";
import { advanceJump, JUMP_VELOCITY } from "../src/rules.js";

test("running rolls the ankles through push-off and touchdown with alternating contacts", () => {
  for (const fps of [30, 60, 120]) {
    const gait = new DinosaurGait(), pitches = [[], []], contacts = [];
    for (let frame = 0; frame < fps * 3; frame++) {
      const pose = gait.update(frame / fps, 1, 0, 1 / fps, 0);
      pose.legs.forEach((leg, i) => pitches[i].push(leg.pitch));
      if (pose.contacts) contacts.push(pose.contacts);
    }
    for (const samples of pitches) {
      assert.ok(Math.min(...samples) < -0.49);
      assert.ok(Math.max(...samples) > 0.17);
    }
    assert.ok(contacts.length >= 8 && contacts.length <= 10);
    assert.ok(contacts.every((contact) => contact === 1 || contact === 2));
    for (let i = 1; i < contacts.length; i++) assert.notEqual(contacts[i], contacts[i - 1]);
  }
});

test("jumps extend into two ordered landings, absorb the impact and recover at every frame rate", () => {
  for (const fps of [30, 60, 120]) for (const offset of [0, 0.13, 0.29, 0.48]) {
    const dt = 1 / fps, gait = new DinosaurGait(), touchdowns = [];
    let time = offset, y = 0, vy = JUMP_VELOCITY, landedAt, peakDrop = 0;
    gait.update(time, 1, 0, dt, 0);
    let previous = structuredClone(gait.pose);
    for (let frame = 0; frame < fps * 2; frame++) {
      time += dt;
      const step = advanceJump(y, vy, dt);
      y = step.y; vy = step.vy;
      const pose = gait.update(time, 1, y, dt, vy);
      if (step.landed) landedAt = time;
      if (y > 0) assert.equal(pose.contacts, 0, "airborne feet cannot emit footsteps");
      if (pose.landingContacts) touchdowns.push({ time, mask: pose.landingContacts, lifts: pose.legs.map((leg) => leg.lift) });
      peakDrop = Math.max(peakDrop, pose.drop);
      for (let i = 0; i < 2; i++) {
        assert.ok(Math.abs(pose.legs[i].z - previous.legs[i].z) < 15 * dt, "foot trajectory stays continuous across takeoff and landing");
        assert.ok(Math.abs(pose.legs[i].lift - previous.legs[i].lift) < 8 * dt, "no foot teleports at the old jump-height cutoff");
      }
      previous = structuredClone(pose);
    }
    assert.equal(touchdowns.length, 2);
    assert.equal(touchdowns[0].time, landedAt);
    assert.notEqual(touchdowns[0].mask, touchdowns[1].mask);
    assert.ok(Math.abs(touchdowns[1].time - touchdowns[0].time - LANDING_STEP_DELAY) <= dt + 1e-9);
    const lead = touchdowns[0].mask === 1 ? 0 : 1;
    assert.equal(touchdowns[0].lifts[lead], 0);
    assert.ok(touchdowns[0].lifts[1 - lead] >= 0.29);
    assert.ok(peakDrop > 0.13 && peakDrop < 0.2);
    assert.equal(gait.pose.mode, "running");
    assert.equal(gait.pose.drop, 0);
    assert.ok(time - landedAt > LANDING_RECOVERY);
  }
});

test("a fresh jump interrupts landing smoothly and returning to camp clears recovery", () => {
  const gait = new DinosaurGait();
  gait.update(0, 1, 0, 1 / 60, 0);
  gait.update(0.2, 1, 1, 1 / 60, 4);
  gait.update(0.9, 1, 0.01, 1 / 60, -10);
  gait.update(0.92, 1, 0, 1 / 60, 0);
  assert.equal(gait.pose.mode, "landing");
  const before = structuredClone(gait.pose);
  gait.update(0.94, 1, 0.17, 1 / 60, 10);
  assert.equal(gait.pose.mode, "takeoff");
  assert.equal(gait.pose.contacts, 0);
  assert.ok(Math.abs(gait.pose.legs[0].z - before.legs[0].z) < 0.02);
  gait.update(1, 0, 0, 1 / 60, 0);
  assert.equal(gait.pose.mode, "idle");
  assert.equal(gait.pose.drop, 0);
  assert.equal(gait.pose.contacts, 0);
});

test("planted feet move steadily backward and cadence responds smoothly to running speed", () => {
  const counts = [];
  for (const speed of [10, 14, 36]) {
    const gait = new DinosaurGait();
    let previous, contacts = 0, plantedSamples = 0;
    for (let frame = 0; frame < 360; frame++) {
      const pose = gait.update(frame / 120, 1, 0, 1 / 120, 0, speed);
      if (pose.contacts) contacts++;
      for (let i = 0; i < 2; i++) {
        const leg = pose.legs[i], before = previous?.legs[i];
        if (before?.lift === 0 && leg.lift === 0) {
          const travel = leg.z - before.z;
          assert.ok(travel > 0 && travel < 0.055, "stance cannot reverse or snap across the ground");
          plantedSamples++;
        }
      }
      previous = structuredClone(pose);
    }
    assert.ok(plantedSamples > 300);
    counts.push(contacts);
  }
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2]);
  assert.ok(counts[2] <= 13, "sprinting should not become a frantic foot shuffle");
});

test("articulated legs keep bone lengths and hit foot targets through running, crouching and flight", () => {
  const thigh = Math.hypot(0.72, 0.27), calf = Math.hypot(0.92, 0.27);
  for (const hipY of [1.24, 1.65, 1.84]) for (const ankleY of [0.12, 0.3, 0.9]) for (const z of [-0.7, -0.3, 0, 0.3, 0.7]) {
    const joint = solveLeg(hipY, ankleY, z, thigh, calf, Math.atan2(0.27, 0.72));
    assert.ok(Object.values(joint).every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(joint.footY + 0.72, joint.footZ + 0.27) - calf) < 1e-10);
    const actualY = joint.y + joint.footY * Math.cos(joint.hip) - joint.footZ * Math.sin(joint.hip);
    const actualZ = joint.footY * Math.sin(joint.hip) + joint.footZ * Math.cos(joint.hip);
    assert.ok(Math.abs(actualY - ankleY) < 1e-10);
    assert.ok(Math.abs(actualZ - z) < 1e-10);
  }
});

test("jumping during impact absorption preserves the compressed body height", () => {
  for (const age of [0.025, 0.075, 0.15, 0.3, 0.5]) {
    const gait = new DinosaurGait(), dt = 1 / 120;
    gait.update(0, 1, 0, dt, 0);
    gait.update(0.2, 1, 1, dt, 5);
    gait.update(0.9, 1, 0.001, dt, -10);
    gait.update(1, 1, 0, dt, 0);
    for (let t = 0; t < age; t += dt) gait.update(1 + t, 1, 0, dt, 0);
    const before = gait.pose.bob - gait.pose.drop;
    const pose = gait.update(1 + age + dt, 1, 0.087, dt, 10.3);
    assert.equal(pose.mode, "takeoff");
    assert.ok(Math.abs(pose.bob - pose.drop - before) < 0.01, "re-jumping cannot snap the body out of its landing compression");
  }
});

test("touchdown eases into compression instead of dropping the body in the first frame", () => {
  for (const fps of [30, 60, 120, 144]) {
    const gait = new DinosaurGait(), dt = 1 / fps;
    gait.update(0, 1, 0, dt, 0);
    gait.update(0.9, 1, 0.01, dt, -10);
    gait.update(1, 1, 0, dt, 0);
    const before = gait.pose.drop;
    gait.update(1 + dt, 1, 0, dt, 0);
    assert.ok(gait.pose.drop - before < 1.5 * dt);
  }
});

test("takeoff finishes behind the hips and straight legs sweep forward during flight", () => {
  for (const fps of [30, 60, 120, 144]) for (const offset of [0, 0.13, 0.29, 0.48]) {
    const gait = new DinosaurGait(), dt = 1 / fps;
    gait.update(offset, 1, 0, dt, 0);
    let y = 0, vy = JUMP_VELOCITY, previous, backSamples = 0, frontSamples = 0;
    for (let frame = 1; frame * dt < 0.75; frame++) {
      ({ y, vy } = advanceJump(y, vy, dt));
      const pose = gait.update(offset + frame * dt, 1, y, dt, vy);
      if (frame * dt >= 0.18) {
        for (let i = 0; i < 2; i++) {
          assert.equal(pose.legs[i].extension, 1, "both knees stay extended while sweeping");
          if (previous) assert.ok(pose.legs[i].z <= previous[i] + 1e-9, "legs sweep forward without reversing");
          if (frame * dt < 0.28) {
            assert.ok(pose.legs[i].z > 0.5, "takeoff ends with the ankles behind the hips");
            backSamples++;
          }
          if (frame * dt > 0.65) {
            assert.ok(pose.legs[i].z < -0.9, "legs reach forward before preparing to land");
            frontSamples++;
          }
        }
        previous = pose.legs.map((leg) => leg.z);
      }
    }
    assert.ok(backSamples && frontSamples);
  }
});

test("landing briefly reduces travel, smoothly recovers, and cannot be cancelled by re-jumping", () => {
  const losses = [];
  for (const fps of [30, 60, 120, 144]) {
    const gait = new DinosaurGait(), dt = 1 / fps;
    gait.update(0, 1, 0, dt, 0);
    gait.update(0.9, 1, 0.01, dt, -10);
    assert.equal(gait.pose.speedScale, 1);
    gait.update(1, 1, 0, dt, 0);
    let loss = 0, min = 1, previous = 1;
    for (let frame = 1; frame <= fps; frame++) {
      const age = frame * dt;
      const { speedScale } = gait.update(1 + age, 1, 0, dt, 0);
      assert.ok(speedScale >= 0.86 && speedScale <= 1);
      assert.ok(Math.abs(speedScale - previous) < 4 * dt, "no instant momentum changes");
      if (age > 0.1) assert.ok(speedScale >= previous, "speed recovers steadily after compression");
      if (age >= 0.55) assert.equal(speedScale, 1);
      loss += 14 * (1 - speedScale) * dt;
      min = Math.min(min, speedScale); previous = speedScale;
    }
    assert.ok(min < 0.87);
    assert.ok(loss > 0.5 && loss < 0.65, "the brief slowdown remains subtle");
    losses.push(loss);
    gait.update(3, 1, 0.01, dt, -10);
    gait.update(3 + dt, 1, 0, dt, 0);
    for (let age = 0; age < 0.08; age += dt) gait.update(3.1, 1, 0, dt, 0);
    const before = gait.pose.speedScale;
    gait.update(3.2, 1, 0.1, dt, 10);
    assert.ok(gait.pose.speedScale < 0.9 && Math.abs(gait.pose.speedScale - before) < 0.01);
    gait.update(4, 0, 0, dt, 0);
    assert.equal(gait.pose.speedScale, 1, "returning to camp clears momentum recovery");
  }
  assert.ok(Math.max(...losses) - Math.min(...losses) < 0.005, "travel loss is stable across frame rates");
});

test("landing flows into the next stride without holding both legs or stalling the second planted foot", () => {
  for (const fps of [30, 60, 120]) for (const speed of [10, 14, 36]) {
    const gait = new DinosaurGait(), dt = 1 / fps;
    gait.update(0.13, 1, 0, dt, 0, speed);
    gait.update(0.9, 1, 0.01, dt, -10, speed);
    gait.update(1, 1, 0, dt, 0, speed);
    const trailing = 1 - gait.lead;
    let previous = structuredClone(gait.pose), firstSwing = Infinity, slowestStance = Infinity, plantedSamples = 0;
    for (let frame = 1; frame * dt < 0.7; frame++) {
      const age = frame * dt, pose = gait.update(1 + age, 1, 0, dt, 0, speed);
      if (pose.legs[gait.lead].lift > 0.02) firstSwing = Math.min(firstSwing, age);
      if (age > 0.18 && age < 0.6 && previous.legs[trailing].lift === 0 && pose.legs[trailing].lift === 0) {
        slowestStance = Math.min(slowestStance, (pose.legs[trailing].z - previous.legs[trailing].z) / dt);
        plantedSamples++;
      }
      if (age >= 0.3) assert.ok(pose.strideWeight > 0.9, "body motion must resume while impact absorption finishes");
      assert.ok(Math.abs(pose.phase - previous.phase) < 25 * dt, "stride phase cannot snap when recovery ends");
      previous = structuredClone(pose);
    }
    assert.ok(firstSwing <= 0.34, `next step starts promptly at ${fps} FPS and ${speed} m/s: ${firstSwing}`);
    assert.ok(plantedSamples >= 3);
    assert.ok(slowestStance > 2.5, `the trailing foot cannot linger in place: ${slowestStance}`);
  }
});

test("knees bend continuously through the extension limit without a sudden angular-speed change", () => {
  const thigh = Math.hypot(0.72, 0.27), calf = Math.hypot(0.92, 0.27), rest = Math.atan2(0.27, 0.72);
  const ankleY = 0.12, z = -0.6, epsilon = 1e-4;
  const limit = ankleY + Math.sqrt((thigh + calf - 0.001) ** 2 - z ** 2);
  const angle = (height) => solveLeg(height, ankleY, z, thigh, calf, rest).hip;
  const before = (angle(limit) - angle(limit - epsilon)) / epsilon;
  const after = (angle(limit + epsilon) - angle(limit)) / epsilon;
  assert.ok(Math.abs(before - after) < 0.02, "crossing full extension cannot abruptly unlock the knee");
  assert.ok(Math.abs(before) < 3 && Math.abs(after) < 3);
});

test("the second foot reaches the ground with continuous velocity and acceleration", () => {
  const dt = 1e-5, gait = new DinosaurGait(), values = new Map();
  gait.update(0, 1, 0, dt, 0);
  gait.update(0.9, 1, 0.01, dt, -10);
  gait.update(1, 1, 0, dt, 0);
  const contact = Math.round(LANDING_STEP_DELAY / dt);
  for (let frame = 1; frame <= contact + 3; frame++) {
    const pose = gait.update(1 + frame * dt, 1, 0, dt, 0);
    if (frame >= contact - 3) values.set(frame, pose.legs[1 - gait.lead].z);
  }
  const at = (offset) => values.get(contact + offset);
  const velocityBefore = (at(0) - at(-1)) / dt, velocityAfter = (at(1) - at(0)) / dt;
  const accelerationBefore = (at(0) - 2 * at(-1) + at(-2)) / dt ** 2;
  const accelerationAfter = (at(2) - 2 * at(1) + at(0)) / dt ** 2;
  assert.ok(Math.abs(velocityBefore - velocityAfter) < 0.01);
  assert.ok(Math.abs(accelerationBefore - accelerationAfter) < 1, "touchdown cannot introduce a jerk in the leg trajectory");
});

test("the leading foot already travels backward at its stance speed before touchdown", () => {
  const gait = new DinosaurGait(), dt = 1e-5;
  gait.update(0, 1, 0, dt, 0);
  for (let i = 0; i < 4; i++) gait.update(i * 0.25, 1, 1, 0.25, -4);
  const samples = [];
  for (const remaining of [2 * dt, dt, 0, -dt]) {
    const height = remaining > 0 ? 10.5 * remaining - 11 * remaining ** 2 : 0;
    const velocity = remaining > 0 ? -10.5 + 22 * remaining : 0;
    const pose = gait.update(1 - remaining, 1, height, dt, velocity);
    samples.push(pose.legs[gait.lead].z);
  }
  const speeds = samples.slice(1).map((z, i) => (z - samples[i]) / dt);
  assert.ok(speeds.every((speed) => speed > 3.8 && speed < 3.9));
  assert.ok(Math.max(...speeds) - Math.min(...speeds) < 0.01, "contact cannot switch the foot from stationary to sliding backward");
});

test("recovery joins the current running stride continuously while the game accelerates", () => {
  const dt = 1e-5;
  for (const initialSpeed of [10, 14, 30]) {
    const gait = new DinosaurGait();
    gait.update(0, 1, 0, dt, 0, initialSpeed);
    gait.update(0.9, 1, 0.01, dt, -10, initialSpeed);
    gait.update(1, 1, 0, dt, 0, initialSpeed);
    let previous = structuredClone(gait.pose), checked = false;
    for (let frame = 1; frame * dt < LANDING_RECOVERY + dt * 3; frame++) {
      const age = frame * dt, pose = gait.update(1 + age, 1, 0, dt, 0, initialSpeed + age * 0.2);
      if (previous.mode === "landing" && pose.mode === "running") {
        pose.legs.forEach((leg, i) => assert.ok(Math.abs(leg.z - previous.legs[i].z) < 12 * dt,
          "the recovery boundary cannot swap in a different stride span"));
        checked = true;
      }
      previous = { mode: pose.mode, legs: pose.legs.map((leg) => ({ z: leg.z })) };
    }
    assert.ok(checked);
  }
});
