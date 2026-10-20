import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ROCK_FORMS, BOULDER_FORMS, rockFormationGeometry, boulderGeometry } from "../src/rock-formations.js";

test("natural formations have finite surfaces, closed grounded bases and repeatable erosion", () => {
  const material = new THREE.MeshBasicMaterial();
  for (const kind of ROCK_FORMS) {
    const geometry = rockFormationGeometry(kind, 10, 12, 7);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0));
    const hit = ray.intersectObject(mesh)[0];
    assert.ok(hit && Math.abs(hit.point.y) < 1e-6, `${kind} must have a solid base instead of an open ring`);
    assert.equal(geometry.boundingBox.min.y, 0);
    for (const key of ["position", "normal", "color", "uv"])
      assert.ok(geometry.attributes[key].array.every(Number.isFinite));
    const duplicate = rockFormationGeometry(kind, 10, 12, 7);
    assert.deepEqual(geometry.attributes.position.array, duplicate.attributes.position.array);
    geometry.dispose(); duplicate.dispose();
  }
  material.dispose();
});

test("stone silhouettes include thin fins, broad mesas, tapered spires and varied boulders", () => {
  const geometries = ROCK_FORMS.map((kind) => rockFormationGeometry(kind, 10, 12, 2));
  const [mesa, , spire, fin] = geometries;
  const depth = (g) => g.boundingBox.max.z - g.boundingBox.min.z;
  assert.ok(depth(fin) < depth(mesa) * 0.5, "fins must have a visibly thinner profile");
  const material = new THREE.MeshBasicMaterial();
  const heightAt = (geometry) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    return new THREE.Raycaster(new THREE.Vector3(2.5, 30, 0), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0].point.y;
  };
  assert.ok(heightAt(mesa) > heightAt(spire) + 4, "a flat-topped mesa and a pointed spire need different contours");
  const boulders = BOULDER_FORMS.map((kind) => boulderGeometry(kind, 3));
  const sizes = boulders.map((geometry) => geometry.boundingBox.getSize(new THREE.Vector3()));
  assert.ok(sizes[2].y / sizes[2].x < sizes[0].y / sizes[0].x * 0.5, "slabs must be flatter than rounded boulders");
  assert.ok(sizes[3].x / sizes[3].z > 2, "elongated fragments must differ from ordinary boulders");
  for (const geometry of boulders) {
    assert.ok(Math.abs(geometry.boundingBox.min.y) < 1e-6);
    assert.ok(geometry.attributes.position.array.every(Number.isFinite));
  }
  [...geometries, ...boulders].forEach((geometry) => geometry.dispose());
  material.dispose();
});
