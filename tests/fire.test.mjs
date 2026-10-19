import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FireBreath, FIRE_DURATION } from "../src/fire-breath.js";

test("fire breath follows the mouth, emits bounded particles, then extinguishes completely", () => {
  const scene = new THREE.Scene(), head = new THREE.Object3D();
  scene.add(head);
  const fire = new FireBreath(scene);
  const buffer = fire.positions;
  head.position.set(2, 3, -4);
  head.rotation.y = 0.4;
  fire.start();
  for (let i = 0; i < 60; i++) {
    head.position.y = 3 + Math.sin(i * 0.15) * 0.08;
    fire.update(1 / 60, head, 20);
    const mouth = head.localToWorld(new THREE.Vector3(0, -0.24, -1.12));
    assert.ok(fire.origin.distanceTo(mouth) < 1e-8);
    assert.ok(fire.alive <= 160);
    assert.ok(fire.positions.every(Number.isFinite));
  }
  assert.equal(fire.bursts, 1);
  assert.ok(fire.alive > 20);
  assert.ok(fire.light.intensity > 0);
  assert.equal(fire.points.visible, true);
  assert.equal(fire.positions, buffer);
  for (let i = 0; i < (FIRE_DURATION + 1) * 60; i++) fire.update(1 / 60, head, 20);
  assert.equal(fire.active, false);
  assert.equal(fire.alive, 0);
  assert.equal(fire.light.intensity, 0);
  assert.equal(fire.points.visible, false);
  fire.start();
  assert.equal(fire.bursts, 2);
  fire.reset();
  assert.equal(fire.active, false);
  assert.equal(fire.bursts, 0);
});

test("stopping a burst clears light and embers immediately without changing gameplay randomness", () => {
  const fire = new FireBreath(new THREE.Scene()), head = new THREE.Object3D();
  const original = Math.random;
  Math.random = () => { throw new Error("cosmetic particles must not consume obstacle randomness"); };
  try {
    fire.start();
    for (let i = 0; i < 30; i++) fire.update(1 / 60, head);
    assert.ok(fire.alive > 0);
    fire.stop();
    assert.equal(fire.active, false);
    assert.equal(fire.light.intensity, 0);
  } finally { Math.random = original; }
});
