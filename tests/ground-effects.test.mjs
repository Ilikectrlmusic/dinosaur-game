import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GroundEffects, DUST_CAPACITY, TRACK_CAPACITY } from "../src/ground-effects.js";

const create = () => new GroundEffects(new THREE.Scene(), (x, z) => -0.04 + x * 0.02);

test("footstep dust stays subtle, with stronger takeoff and landing impulses that completely settle", () => {
  const bursts = [];
  for (const kind of ["run", "takeoff", "landing"]) {
    const effects = create();
    effects.emit(0.6, 0.4, kind);
    const initial = effects.particles.filter((p) => p.age === 0);
    assert.ok(initial.every((p) => p.y > -0.04 && p.y < 0.05), "dust must start at the terrain, not at the hip");
    let maxAlpha = 0, maxSize = 0, maxHeight = 0;
    for (let frame = 0; frame < 120; frame++) {
      effects.update(1 / 60, 14);
      maxAlpha = Math.max(maxAlpha, ...effects.alphas);
      maxSize = Math.max(maxSize, ...effects.sizes);
      for (const p of effects.particles) if (p.age < p.life) maxHeight = Math.max(maxHeight, p.y);
      assert.ok(effects.positions.every(Number.isFinite));
    }
    assert.ok(maxAlpha < 0.22 && maxSize < 0.95 && maxHeight < 0.6, "a contact cannot create an opaque smoke cloud");
    assert.equal(effects.alive, 0);
    assert.equal(effects.points.visible, false);
    bursts.push({ count: initial.length, maxSize });
  }
  assert.ok(bursts[0].count < bursts[1].count && bursts[1].count < bursts[2].count);
  assert.ok(bursts[0].maxSize < bursts[1].maxSize && bursts[1].maxSize < bursts[2].maxSize);
});

test("grounded prints follow exactly the terrain travel, and dust drift is stable across frame rates", () => {
  const snapshots = [];
  for (const fps of [30, 60, 120]) {
    const effects = create();
    effects.emit(-0.5, 2, "run");
    for (let i = 0; i < fps * 0.4; i++) effects.update(1 / fps, 18);
    snapshots.push([...effects.positions.slice(0, 12)]);
    assert.ok(Math.abs(effects.tracks[0].z - (2 + 18 * 0.4)) < 1e-10, "a footprint cannot slide relative to the ground");
    const matrix = new THREE.Matrix4(); effects.footprints.getMatrixAt(0, matrix);
    assert.ok(Math.abs(matrix.elements[13] - (-0.04 - 0.5 * 0.02 + 0.017)) < 1e-6);
    effects.update(8);
    assert.equal(effects.tracksAlive, 0);
    assert.equal(effects.footprints.visible, false);
  }
  snapshots.slice(1).forEach((snapshot) => snapshot.forEach((value, i) =>
    assert.ok(Math.abs(value - snapshots[0][i]) < 1e-6, "particle motion cannot depend on rendering FPS")));
});

test("pools and buffers remain bounded through repeated impacts, without consuming gameplay randomness", () => {
  const effects = create(), positions = effects.positions, matrices = effects.footprints.instanceMatrix;
  const original = Math.random;
  Math.random = () => { throw new Error("visual effects must use their own RNG"); };
  try {
    for (let i = 0; i < 200; i++) {
      effects.emit(i % 2 ? -0.5 : 0.5, 0, i % 3 ? "landing" : "crash");
      effects.update(1 / 120, 30);
    }
    assert.ok(effects.alive <= DUST_CAPACITY && effects.tracksAlive <= TRACK_CAPACITY);
    assert.equal(effects.positions, positions);
    assert.equal(effects.footprints.instanceMatrix, matrices);
    effects.reset();
    assert.equal(effects.alive + effects.tracksAlive, 0);
    assert.deepEqual(effects.emissions, { run: 0, takeoff: 0, landing: 0, crash: 0 });
    assert.ok(effects.alphas.every((alpha) => alpha === 0));
    assert.equal(effects.points.visible || effects.footprints.visible || effects.footShadows.visible, false);
  } finally { Math.random = original; }
});

test("foot contact shadows stay on the terrain and disappear as the feet lift", () => {
  const effects = create(), root = new THREE.Group();
  const legs = [-1, 1].map((side) => {
    const foot = new THREE.Object3D(); foot.position.set(side * 0.5, 0.1, 0.4); root.add(foot);
    return { foot };
  });
  const dino = { root, legs, sizeScale: 1, gait: { pose: { legs: [{ lift: 0 }, { lift: 0.5 }] } } };
  root.updateMatrixWorld(true);
  effects.followFeet(dino);
  const alpha = effects.footShadows.geometry.attributes.contactOpacity.array;
  assert.ok(alpha[0] > 0.2 && alpha[1] < 0.002);
  root.position.y = 2; root.updateMatrixWorld(true);
  effects.followFeet(dino);
  assert.ok(alpha.every((value) => value < 1e-8));
  effects.followFeet(null);
  assert.equal(effects.footShadows.visible, false);
});
