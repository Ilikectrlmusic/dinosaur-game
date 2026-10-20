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
