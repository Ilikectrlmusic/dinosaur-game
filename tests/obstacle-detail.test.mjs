import test from "node:test";
import assert from "node:assert/strict";
import { cactusArmPoint, cactusArmContacts, CACTUS_ARM_RADIUS } from "../src/cactus-shape.js";
import { cactusArmGeometry, wingMembraneGeometry, wingPoint } from "../src/obstacle-detail.js";

test("rounded cactus arms have continuous tangents, grounded-gameplay heights and matching collision samples", () => {
  for (const height of [1.05, 1.55, 2.05, 3.8]) for (const side of [-1, 1]) {
    let previous;
    for (let i = 0; i <= 1000; i++) {
      const point = cactusArmPoint(height, side, i / 1000);
      if (previous) {
        assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002);
        assert.ok(Math.hypot(point.tx - previous.tx, point.ty - previous.ty) < 0.01);
      }
      previous = point;
    }
    const geometry = cactusArmGeometry(height, side);
    geometry.computeBoundingBox();
    const top = height * (side === 1 ? 0.93 : 0.77);
    assert.ok(Math.abs(geometry.boundingBox.max.y - top) < 1e-6);
    assert.ok(geometry.boundingBox.max.y <= height);
    assert.ok(Math.max(Math.abs(geometry.boundingBox.min.x), Math.abs(geometry.boundingBox.max.x)) <= 0.616);
    const contacts = cactusArmContacts(height, side);
    for (let i = 1; i < contacts.length; i++)
      assert.ok(Math.hypot(contacts[i].x - contacts[i - 1].x, contacts[i].y - contacts[i - 1].y) <= 0.0351);
    assert.ok(Math.abs(contacts.at(-1).y + CACTUS_ARM_RADIUS - top) < 1e-10);
    // An outward normal ensures the rounded elbow is visible from outside.
    assert.ok(geometry.attributes.normal.getY(0) * side > 0.9);
    geometry.dispose();
  }
});

test("cambered pterosaur wings are mirrored, smoothly tessellated and keep their original span", () => {
  const left = wingMembraneGeometry(-1), right = wingMembraneGeometry(1);
  const a = left.attributes.position, b = right.attributes.position;
  assert.ok(a.count > 400 && a.count < 800);
  for (let i = 0; i < a.count; i++) {
    assert.equal(a.getX(i), -b.getX(i));
    assert.equal(a.getY(i), b.getY(i));
    assert.equal(a.getZ(i), b.getZ(i));
    for (const geometry of [left, right]) for (const value of ["X", "Y", "Z"])
      assert.ok(Number.isFinite(geometry.attributes.normal[`get${value}`](i)));
  }
  right.computeBoundingBox();
  assert.ok(Math.abs(right.boundingBox.max.x - 2.05) < 1e-6);
  assert.ok(wingPoint(1, 0.5, 0.5).y > (wingPoint(1, 0.5, 0).y + wingPoint(1, 0.5, 1).y) / 2 + 0.08);
  assert.ok(right.index.count / 3 <= 1000);
  left.dispose(); right.dispose();
});
