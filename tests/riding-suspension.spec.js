import { test, expect } from "@playwright/test";

test("rider legs keep a fitted seated pose while panniers hang outside the skin and straps stay attached", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/?rig-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/?rig-test");
  const results = await page.evaluate(async () => {
    const source = await (await fetch("/src/main.js")).text();
    const { Vector3, Raycaster, Box3 } = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { advanceJump, JUMP_VELOCITY } = await import("/src/rules.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const results = [], point = new Vector3(), vertex = new Vector3(), a = new Vector3(), b = new Vector3(), ray = new Raycaster();
    for (const [index, mount] of MOUNTS.entries()) for (const fps of [30, 60, 120]) {
      const dino = buildDinosaur(index, mount.id), dt = 1 / fps;
      const torso = new Box3();
      for (const mesh of dino.body.children) if (mesh.isMesh) torso.union(new Box3().setFromObject(mesh, true));
      const bodyHalf = (torso.max.x - torso.min.x) / 2;
      const skin = dino.skinSurface.profiles.flatMap(({ group }) => group.children.filter((o) => o.isMesh));
      let y = 0, vy = 0, boneError = 0, strapError = 0, meshPinError = 0, penetration = 0, worst = null, maxSpeed = 0;
      let prior = null, samples = 0, fastest = null, poseDrift = 0, seatedPose, maxAbduction = 0, maxFootSpread = 0, maxBagStrap = 0, maxRenderedStrap = 0;
      for (let frame = 0; frame < fps * 4; frame++) {
        const time = frame * dt;
        if (frame === Math.round(fps * 0.7)) vy = JUMP_VELOCITY;
        ({ y, vy } = advanceJump(y, vy, dt)); dino.root.position.y = y;
        const duck = time > 2.4 && time < 3.4 ? Math.sin((time - 2.4) * Math.PI) ** 2 : 0;
        animateDinosaur(dino, time, 1, duck, y, dt, 0, vy, 14 + time * 0.2);
        const joints = dino.rider.limbs.flatMap(({ leg, knee, boot }) => [leg, knee, boot]);
        if (!seatedPose) seatedPose = joints.map((joint) => joint.quaternion.clone());
        joints.forEach((joint, i) => { poseDrift = Math.max(poseDrift, 1 - Math.abs(joint.quaternion.dot(seatedPose[i]))); });
        const current = [];
        for (const [i, limb] of dino.rider.limbs.entries()) {
          limb.leg.getWorldPosition(a); limb.knee.getWorldPosition(b);
          boneError = Math.max(boneError, Math.abs(a.distanceTo(b) - 0.56));
          maxAbduction = Math.max(maxAbduction, Math.atan2(Math.abs(b.x - a.x), a.y - b.y));
          limb.boot.getWorldPosition(a);
          maxFootSpread = Math.max(maxFootSpread, Math.abs(a.x) / bodyHalf);
          boneError = Math.max(boneError, Math.abs(a.distanceTo(b) - 0.50));
          current.push(...a.toArray());
          limb.boot.localToWorld(a.set(limb.side * 0.1, 0.025, -0.02));
          dino.root.worldToLocal(a);
          strapError = Math.max(strapError, a.distanceTo(dino.suspension.legs[i].chain.nodes.at(-1).position));
        }
        for (const [i, bag] of dino.panniers.entries()) {
          bag.group.localToWorld(a.set(0, 0.2, 0)); dino.root.worldToLocal(a);
          strapError = Math.max(strapError, a.distanceTo(dino.suspension.chains[i].nodes.at(-1).position));
          bag.group.getWorldPosition(a); current.push(...a.toArray());
          const nodes = dino.suspension.chains[i].nodes;
          let length = 0;
          for (let n = 1; n < nodes.length; n++) length += nodes[n].position.distanceTo(nodes[n - 1].position);
          maxBagStrap = Math.max(maxBagStrap, length);
          const positions = bag.strap.geometry.attributes.position;
          for (let lane = 0; lane < 2; lane++) {
            let renderedLength = 0;
            for (let n = 0; n < nodes.length; n++) {
              point.set(0, 0, 0);
              for (let j = 0; j < 4; j++) point.add(vertex.fromBufferAttribute(positions, (lane * nodes.length + n) * 4 + j));
              point.multiplyScalar(0.25);
              if (n) renderedLength += point.distanceTo(b);
              b.copy(point);
            }
            maxRenderedStrap = Math.max(maxRenderedStrap, renderedLength);
            point.set(0, 0, 0);
            const firstVertex = (lane * nodes.length + nodes.length - 1) * 4;
            for (let j = 0; j < 4; j++) point.add(vertex.fromBufferAttribute(positions, firstVertex + j));
            point.multiplyScalar(0.25);
            bag.group.localToWorld(b.set(0, 0.2, lane ? 0.12 : -0.12)); dino.root.worldToLocal(b);
            meshPinError = Math.max(meshPinError, point.distanceTo(b));
          }
        }
        if (prior) for (let i = 0; i < current.length; i += 3) {
          // Subtract the root flight: measure relative hanging motion.
          const speed = Math.hypot(current[i] - prior[i], current[i + 1] - prior[i + 1] - (y - prior.at(-1)), current[i + 2] - prior[i + 2]) / dt;
          if (speed > maxSpeed) { maxSpeed = speed; fastest = { time, index: i / 3, from: prior.slice(i, i + 3), to: current.slice(i, i + 3) }; }
        }
        prior = [...current, y];
        if (fps === 60 && frame % 20 === 0) {
          const parts = [...dino.rider.limbs.map(({ leg, side }) => ({ group: leg, side, type: "leg" })),
            ...dino.panniers.map(({ group, side }) => ({ group, side, type: "bag" }))];
          for (const { group, side, type } of parts) group.traverse((mesh) => {
            if (!mesh.isMesh) return;
            const vertices = mesh.geometry.attributes.position;
            for (let i = 0; i < vertices.count; i += Math.max(1, Math.floor(vertices.count / 18))) {
              point.fromBufferAttribute(vertices, i); mesh.localToWorld(point);
              ray.set(a.set(side * 3, point.y, point.z), b.set(-side, 0, 0));
              const hit = ray.intersectObjects(skin, false)[0];
              if (!hit) continue;
              samples++;
              const depth = side * (hit.point.x - point.x);
              if (depth > penetration) { penetration = depth; worst = { type, time, duck, point: point.toArray(), skin: hit.point.toArray() }; }
            }
          });
        }
      }
      results.push({ mount: mount.id, fps, boneError, strapError, meshPinError, penetration, worst, maxSpeed, fastest, samples, poseDrift, maxAbduction, maxFootSpread, maxBagStrap, maxRenderedStrap });
    }
    return results;
  });
  for (const result of results) {
    expect(result.boneError, JSON.stringify(result)).toBeLessThan(1e-8);
    expect(result.poseDrift, JSON.stringify(result)).toBeLessThan(1e-10);
    expect(result.strapError, JSON.stringify(result)).toBeLessThan(1e-8);
    expect(result.meshPinError, JSON.stringify(result)).toBeLessThan(5e-7);
    expect(result.penetration, JSON.stringify({ mount: result.mount, ...result.worst })).toBeLessThan(0.005);
    expect(result.maxAbduction, JSON.stringify(result)).toBeLessThan(1.0);
    expect(result.maxFootSpread, JSON.stringify(result)).toBeLessThan(1.55);
    expect(result.maxBagStrap, JSON.stringify(result)).toBeLessThan(0.38);
    expect(result.maxRenderedStrap, JSON.stringify(result)).toBeLessThan(0.40);
    expect(result.maxSpeed, JSON.stringify(result)).toBeLessThan(8);
    if (result.fps === 60) expect(result.samples).toBeGreaterThan(500);
  }
});

test("camp ropes remain bounded through slow startup frames before any camera or gameplay input", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/?slow-camp-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/?slow-camp-test");
  const results = await page.evaluate(async () => {
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const profiles = {
      steady30: Array(90).fill(1 / 30),
      startupStalls: Array.from({ length: 90 }, (_, i) => [0.25, 0.1, 0.05][i % 3]),
      recovering: Array.from({ length: 90 }, (_, i) => i < 30 ? 0.25 : [1 / 120, 1 / 60, 1 / 30][i % 3]),
    };
    const results = [];
    for (const mount of MOUNTS) for (const [profile, frames] of Object.entries(profiles)) {
      const dino = buildDinosaur(1, mount.id);
      const ropes = [...dino.reins, ...dino.stirrupStraps, ...dino.panniers.map(({ strap }) => strap)];
      const buffers = ropes.map((rope) => rope.geometry.attributes.position.array);
      let time = 0, maxCoordinate = 0, maxStretch = 1, finite = true, reused = true;
      for (const dt of frames) {
        time += dt;
        animateDinosaur(dino, time, 0, 0, 0, dt);
        for (const [i, rope] of ropes.entries()) {
          const { position, normal } = rope.geometry.attributes;
          reused &&= position.array === buffers[i];
          for (const value of position.array) {
            finite &&= Number.isFinite(value);
            maxCoordinate = Math.max(maxCoordinate, Math.abs(value));
          }
          finite &&= normal.array.every(Number.isFinite);
        }
        for (const chain of [...dino.suspension.chains, ...dino.suspension.legs.map(({ chain }) => chain)]) {
          let length = 0;
          for (let n = 1; n < chain.nodes.length; n++) length += chain.nodes[n].position.distanceTo(chain.nodes[n - 1].position);
          maxStretch = Math.max(maxStretch, length / chain.length);
        }
      }
      results.push({ mount: mount.id, profile, finite, reused, maxCoordinate, maxStretch });
    }
    return results;
  });
  for (const result of results) {
    expect(result.finite, JSON.stringify(result)).toBe(true);
    expect(result.reused, JSON.stringify(result)).toBe(true);
    expect(result.maxCoordinate, JSON.stringify(result)).toBeLessThan(5);
    expect(result.maxStretch, JSON.stringify(result)).toBeLessThan(1.15);
  }
});

test("all panniers rest against actual flanks from the first camp frame, including the smallest mount", async ({ page }) => {
  test.setTimeout(90000);
  await page.route("**/?pannier-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/?pannier-test");
  const results = await page.evaluate(async () => {
    const source = await (await fetch("/src/main.js")).text();
    const { Vector3, Raycaster } = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const point = new Vector3(), origin = new Vector3(), direction = new Vector3(), ray = new Raycaster(), results = [];
    for (const mount of MOUNTS) {
      const dino = buildDinosaur(0, mount.id);
      const skin = dino.skinSurface.profiles.flatMap(({ group }) => group.children.filter((o) => o.isMesh));
      let largestGap = 0, samples = 0, worst = null;
      for (let frame = 0; frame <= 120; frame++) {
        if (frame) animateDinosaur(dino, frame / 60, 0, 0, 0, 1 / 60);
        if (![0, 1, 15, 30, 60, 120].includes(frame)) continue;
        for (const { group, side } of dino.panniers) {
          // Check every point across the inner face, including its rear edge.
          // Looking from behind must not reveal a gap hidden by a lower corner.
          for (const z of [-0.12, 0, 0.12]) {
            for (const y of [-0.06, 0, 0.06]) {
              group.localToWorld(point.set(-side * 0.13, y, z));
              ray.set(origin.set(side * 3, point.y, point.z), direction.set(-side, 0, 0));
              const hit = ray.intersectObjects(skin, false)[0];
              const gap = hit ? side * (point.x - hit.point.x) : Infinity;
              samples++;
              if (gap > largestGap) { largestGap = gap; worst = { frame, side, y, z, gap }; }
            }
          }
        }
      }
      results.push({ mount: mount.id, largestGap, worst, samples });
    }
    return results;
  });
  for (const result of results) {
    expect(result.largestGap, JSON.stringify(result)).toBeLessThan(0.065);
    expect(result.samples).toBe(108);
  }
});
