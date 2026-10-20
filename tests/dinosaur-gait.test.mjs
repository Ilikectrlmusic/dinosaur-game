import { test } from "node:test";
import assert from "node:assert/strict";
import { DinosaurGait, LANDING_STEP_DELAY, LANDING_RECOVERY } from "../src/dinosaur-gait.js";
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
    for (let frame = 0; frame < fps * 1.6; frame++) {
      time += dt;
      const step = advanceJump(y, vy, dt);
      y = step.y; vy = step.vy;
      const pose = gait.update(time, 1, y, dt, vy);
      if (step.landed) landedAt = time;
      if (y > 0) assert.equal(pose.contacts, 0, "airborne feet cannot emit footsteps");
      if (pose.landingContacts) touchdowns.push({ time, mask: pose.landingContacts, lifts: pose.legs.map((leg) => leg.lift) });
      peakDrop = Math.max(peakDrop, pose.drop);
      for (let i = 0; i < 2; i++) {
        assert.ok(Math.abs(pose.legs[i].hip - previous.legs[i].hip) < 15 * dt, "leg rotation stays continuous across takeoff and landing");
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
  assert.equal(gait.pose.mode, "airborne");
  assert.equal(gait.pose.contacts, 0);
  assert.ok(Math.abs(gait.pose.legs[0].hip - before.legs[0].hip) < 0.02);
  gait.update(1, 0, 0, 1 / 60, 0);
  assert.equal(gait.pose.mode, "idle");
  assert.equal(gait.pose.drop, 0);
  assert.equal(gait.pose.contacts, 0);
});
