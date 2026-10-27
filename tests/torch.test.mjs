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
      assert.ok(torch.light.intensity > 60 && torch.light.intensity < 75);
      assert.ok(torch.groundLight.target.position.y < torch.light.position.y);
      assert.ok(torch.alive <= 24); assert.ok(torch.positions.every(Number.isFinite));
    }
    assert.ok(torch.alive > 0); assert.equal(torch.positions, buffer);
    const obstacle = new THREE.Vector3(0, 1.2, -24).sub(torch.groundLight.position);
    const forward = torch.groundLight.target.position.clone().sub(torch.groundLight.position);
    assert.ok(obstacle.angleTo(forward) < torch.groundLight.angle * 0.7, "upcoming obstacles should be in the bright part of the beam");
    const distance = obstacle.length();
    const attenuation = Math.max(0, 1 - (distance / torch.groundLight.distance) ** 4) ** 2 / (distance * distance);
    assert.ok(torch.groundLight.intensity * attenuation > 0.2, "the torch must illuminate the track well before the next obstacle");
    for (let i = 0; i < 120; i++) torch.update(1 / 60, hand, 0, 2 + i / 60);
    assert.equal(torch.root.visible, false); assert.equal(torch.sparks.visible, false);
    assert.equal(torch.light.intensity, 0); assert.equal(torch.groundLight.intensity, 0);
    assert.equal(torch.light.visible, false); assert.equal(torch.groundLight.visible, false);
    assert.equal(torch.groundLight.castShadow, false, "firelight must never render an extra shadow pass");
    assert.equal(scene.children.includes(torch.light), true, "daylight must keep the light count stable");
    torch.reset(); assert.equal(torch.alive, 0);
  } finally { Math.random = original; }
});

test("the flame trails in the wind, compresses on ascent and stretches on descent without detaching", () => {
  const scene = new THREE.Scene(), hand = new THREE.Object3D(); scene.add(hand); hand.position.y = 4;
  const torch = new RiderTorch(scene), { wind, stretch } = torch.flameMaterial.uniforms;
  let time = 0;
  const advance = (velocity, frames = 40) => {
    for (let i = 0; i < frames; i++) {
      hand.position.y += velocity / 60; time += 1 / 60;
      torch.update(1 / 60, hand, 1, time, { speed: 18 });
      assert.ok(torch.root.position.distanceTo(hand.position) < 1e-10);
      assert.ok(wind.value.length() < 0.4 && Number.isFinite(stretch.value));
    }
    return stretch.value;
  };
  advance(0);
  const fireDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(torch.flame.quaternion).applyQuaternion(torch.root.quaternion);
  assert.ok(fireDirection.z > 0.55, "running airflow tilts the whole flame backwards from its base");
  assert.ok(advance(3) < 0.95, "rising air speed compresses the flame");
  assert.ok(advance(-3) > 1.05, "falling lets the flame trail upwards");
  assert.ok(Math.abs(advance(0, 120) - 1) < 0.01, "the flame settles smoothly after landing");
  torch.reset(); hand.position.y += 10; torch.update(1 / 60, hand, 1, time);
  assert.equal(stretch.value, 1, "respawning must not produce an artificial gust");
});

test("fast airflow leans the entire fire behind the mount even when the camera looks backwards", () => {
  const scene = new THREE.Scene(), hand = new THREE.Object3D(); scene.add(hand); hand.position.y = 4;
  const camera = new THREE.PerspectiveCamera(53, 1, 0.08, 800); camera.position.y = 4;
  camera.rotation.y = Math.PI; camera.updateMatrixWorld(true);
  const torch = new RiderTorch(scene), direction = new THREE.Vector3(), pivot = new THREE.Vector3();
  const z = [];
  for (const speed of [0, 14, 36]) {
    for (let i = 0; i < 120; i++) torch.update(1 / 60, hand, 1, i / 60, { speed, camera, firstPerson: true });
    direction.set(0, 1, 0).applyQuaternion(torch.flame.getWorldQuaternion(new THREE.Quaternion()));
    z.push(direction.z);
    torch.flame.getWorldPosition(pivot);
    assert.ok(pivot.distanceTo(torch.root.localToWorld(new THREE.Vector3(0, 0.6, 0))) < 1e-10, "the base stays on the wick while the plume leans");
  }
  assert.ok(z[0] < 0.15 && z[1] > 0.4 && z[2] > 0.8, `speed must increase the visible backward lean: ${z}`);
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
