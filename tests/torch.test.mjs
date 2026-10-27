import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { RiderTorch } from "../src/rider-torch.js";

test("the held torch lights its surroundings, reuses bounded ember buffers and extinguishes at daybreak", () => {
  const scene = new THREE.Scene(), hand = new THREE.Object3D(); scene.add(hand);
  hand.position.set(0.5, 4.1, -0.3);
  const torch = new RiderTorch(scene), buffer = torch.positions, original = Math.random;
  Math.random = () => { throw new Error("embers must not consume obstacle randomness"); };
  try {
    for (let i = 0; i < 120; i++) {
      hand.position.y = 4.1 + Math.sin(i / 20) * 0.03;
      torch.update(1 / 60, hand, 1, i / 60, { speed: 20 });
      assert.ok(torch.root.position.distanceTo(hand.position) < 1e-10);
      assert.ok(torch.light.position.distanceTo(torch.origin) < 1e-10);
      assert.ok(torch.light.intensity > 35 && torch.light.intensity < 55);
      assert.ok(torch.groundLight.target.position.y < torch.light.position.y);
      assert.ok(torch.alive <= 24); assert.ok(torch.positions.every(Number.isFinite));
    }
    assert.ok(torch.alive > 0); assert.equal(torch.positions, buffer);
    for (let i = 0; i < 120; i++) torch.update(1 / 60, hand, 0, 2 + i / 60);
    assert.equal(torch.root.visible, false); assert.equal(torch.sparks.visible, false);
    assert.equal(torch.light.intensity, 0); assert.equal(torch.groundLight.intensity, 0);
    assert.equal(scene.children.includes(torch.light), true, "daylight must keep the light count stable");
    torch.reset(); assert.equal(torch.alive, 0);
  } finally { Math.random = original; }
});

test("first-person torch stays beside the view and remains lit when the rider is hidden", () => {
  const scene = new THREE.Scene(), rider = new THREE.Group(), hand = new THREE.Object3D();
  scene.add(rider); rider.add(hand); rider.visible = false;
  const camera = new THREE.PerspectiveCamera(53, 390 / 844, 0.08, 800); camera.position.set(0, 4, 0); camera.updateMatrixWorld(true);
  const torch = new RiderTorch(scene);
  torch.update(1 / 60, hand, 1, 1, { firstPerson: true, camera });
  const screen = torch.origin.clone().project(camera);
  assert.ok(screen.x > 0.5 && screen.x < 1); assert.ok(Math.abs(screen.y) < 0.5);
  assert.equal(torch.root.visible, true); assert.ok(torch.light.intensity > 0);
  assert.ok(Number.isFinite(torch.sparks.material.uniforms.pointScale.value));
});

test("a falling rider carries the torch with the hand and the flame goes out if buried in the ground", () => {
  const scene = new THREE.Scene(), hand = new THREE.Object3D(); scene.add(hand); hand.position.y = 4;
  const torch = new RiderTorch(scene); torch.update(1 / 60, hand, 1, 0);
  torch.beginCrash(); hand.rotation.z = Math.PI / 2; hand.updateMatrixWorld(true);
  const before = torch.root.quaternion.clone(); torch.update(1 / 60, hand, 1, 0.1);
  assert.ok(before.angleTo(torch.root.quaternion) > 1);
  hand.position.y = -1; torch.update(1 / 60, hand, 1, 0.2);
  assert.equal(torch.strength, 0); assert.equal(torch.light.intensity, 0);
});
