import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SkinSurface } from "../src/skin-surface.js";

test("skin contacts follow the actual mesh width, scale and moving frame on both sides", () => {
  for (const width of [0.87, 1, 1.08]) {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    body.scale.x = width;
    body.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial()));
    root.updateMatrixWorld(true);
    const surface = new SkinSurface(root, [body]);
    for (const side of [-1, 1]) for (const y of [-0.6, 0, 0.6]) {
      const point = new THREE.Vector3(side * 0.2, y, 0.1);
      surface.projectSphere(point, 0.1, side);
      const analyticSkin = width * Math.sqrt(1 - y * y - 0.1 ** 2);
      assert.ok(side * point.x >= analyticSkin + 0.095);
      assert.ok(side * point.x < width + 0.22);
    }
    body.position.y = 0.4; body.rotation.x = 0.3;
    root.position.set(7, 2, -4); root.rotation.y = 0.7; root.scale.setScalar(1.06);
    root.updateMatrixWorld(true); surface.update();
    const point = new THREE.Vector3(0.2, 0.4, 0);
    surface.projectSphere(point, 0.1, 1);
    assert.ok(point.x >= width + 0.095 && point.x < width + 0.2);
  }
});

test("hanging box contacts include its lower corners, and repeated queries reuse the baked surface", () => {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24)); body.add(mesh);
  root.updateMatrixWorld(true);
  const surface = new SkinSurface(root, [body]), field = surface.profiles[0].right;
  const top = new THREE.Vector3(0.4, 1.1, 0), half = new THREE.Vector3(0.14, 0.2, 0.2);
  surface.projectBox(top, half, 1);
  const lowerSkin = Math.sqrt(1 - 0.7 ** 2);
  assert.ok(top.x - half.x >= lowerSkin);
  for (let i = 0; i < 1000; i++) surface.projectBox(top, half, 1);
  assert.equal(surface.profiles[0].right, field);
  assert.ok(Number.isFinite(top.x) && top.x < 1.2);
});
