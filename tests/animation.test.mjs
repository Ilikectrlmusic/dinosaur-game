import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FlexibleRein } from "../src/flexible-rein.js";
import { ScrollingScenery } from "../src/scrolling-scenery.js";

test("mountains travel with the track, stop with it, and loop continuously in the visible area", () => {
  const tile = new THREE.Group();
  const mountain = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 20));
  mountain.position.set(45, 15, -65);
  tile.add(mountain);
  const scenery = new ScrollingScenery(tile);
  const position = new THREE.Vector3();
  const visible = () => {
    scenery.updateMatrixWorld(true);
    return scenery.children.map((copy) => copy.children[0].getWorldPosition(position).z).filter((z) => Math.abs(z) < 700).sort((a, b) => a - b);
  };
  scenery.update(20);
  const before = visible();
  scenery.update(70);
  assert.deepEqual(visible(), before.map((z) => z + 50));
  scenery.update(70);
  assert.deepEqual(visible(), before.map((z) => z + 50));
  scenery.update(419.99);
  const seam = visible();
  scenery.update(420.01);
  visible().forEach((z, i) => assert.ok(Math.abs(z - seam[i] - 0.02) < 1e-9));
  scenery.update(420 * 10000 + 70);
  assert.deepEqual(visible(), before.map((z) => z + 50));
});

test("soft reins sag under gravity while both attachment points remain pinned during bobbing", () => {
  for (const side of [-1, 1]) {
    const rein = new FlexibleRein(new THREE.MeshBasicMaterial(), side);
    const start = new THREE.Vector3(side * 0.34, 3.15, -0.5);
    const end = new THREE.Vector3(side * 0.34, 3, -2.22);
    const buffer = rein.geometry.attributes.position.array;
    for (let i = 0; i < 180; i++) rein.update(start, end);
    const middle = rein.points[10];
    assert.ok(middle.y < (start.y + end.y) / 2 - 0.1, "gravity should leave visible slack");
    for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.25]) {
      for (let i = 0; i < 100; i++) {
        start.y = 3.15 + Math.sin(i * 0.15) * 0.085;
        end.y = 3 + Math.sin(i * 0.2) * 0.04;
        rein.update(start, end, dt);
        assert.deepEqual(rein.points[0], start);
        assert.deepEqual(rein.points.at(-1), end);
        assert.ok(rein.geometry.attributes.position.array.every(Number.isFinite));
      }
    }
    assert.equal(rein.geometry.attributes.position.array, buffer, "animation must reuse the geometry buffer");
    const length = rein.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(rein.points[i]), 0);
    assert.ok(length < rein.length * 1.2, "the rein must resist stretching");
  }
});
