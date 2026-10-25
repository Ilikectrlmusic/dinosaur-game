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

test("an empty region above a thigh cannot push luggage away from the real skin", () => {
  const root = new THREE.Group(), hip = new THREE.Group();
  hip.position.set(0.5, 1.8, 0.6); hip.userData.suspensionSweep = true; root.add(hip);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24));
  mesh.scale.set(0.27, 0.6, 0.23); mesh.position.y = -0.4; hip.add(mesh);
  root.updateMatrixWorld(true);
  const surface = new SkinSurface(root, [hip]);
  const top = new THREE.Vector3(0.56, 2.65, 0.6), initial = top.clone();
  surface.projectBox(top, new THREE.Vector3(0.145, 0.2, 0.205), 1);
  assert.ok(top.distanceTo(initial) < 1e-10);
  hip.rotation.x = 0.4; root.updateMatrixWorld(true); surface.update();
  surface.projectBox(top, new THREE.Vector3(0.145, 0.2, 0.205), 1);
  assert.ok(top.distanceTo(initial) < 1e-10);
});

test("sloping skin uses triangle intersections instead of each triangle's widest vertex", () => {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const geometry = new THREE.BoxGeometry(1, 1, 1), vertices = geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) vertices.setX(i, vertices.getX(i) + 0.4 * vertices.getY(i) + 0.2 * vertices.getZ(i));
  body.add(new THREE.Mesh(geometry)); root.updateMatrixWorld(true);
  const surface = new SkinSurface(root, [body]);
  for (const side of [-1, 1]) for (const y of [-0.35, 0, 0.35]) for (const z of [-0.35, 0.2]) {
    const actual = surface.outside(new THREE.Vector3(0, y, z), side);
    assert.ok(Math.abs(actual - (0.5 + side * (0.4 * y + 0.2 * z))) < 1e-6);
  }
});

test("a rising flank lifts a hanging box without stretching its short strap", () => {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  body.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32))); root.updateMatrixWorld(true);
  const surface = new SkinSurface(root, [body]), half = new THREE.Vector3(0.145, 0.2, 0.205);
  for (const side of [-1, 1]) {
    const anchor = new THREE.Vector3(side * 0.35, 1.13, 0), top = new THREE.Vector3(side * 0.55, 0.85, 0);
    surface.projectBox(top, half, side, new THREE.Quaternion(), anchor, 0.31);
    assert.ok(top.y > 0.85);
    assert.ok(top.distanceTo(anchor) < 0.312);
    assert.ok(surface.boxClearance(top, half, side) < 0.001);
  }
});
