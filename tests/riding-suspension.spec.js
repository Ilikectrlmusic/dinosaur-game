import { test, expect } from "@playwright/test";

test("rider legs keep a fitted seated pose while panniers hang outside the skin and straps stay attached", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/?rig-test", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/?rig-test");
  const results = await page.evaluate(async () => {
    const source = await (await fetch("/src/main.js")).text();
    const { Vector3, Raycaster } = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { advanceJump, JUMP_VELOCITY } = await import("/src/rules.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const results = [], point = new Vector3(), a = new Vector3(), b = new Vector3(), ray = new Raycaster();
    for (const [index, mount] of MOUNTS.entries()) for (const fps of [30, 60, 120]) {
      const dino = buildDinosaur(index, mount.id), dt = 1 / fps;
      const skin = dino.skinSurface.profiles.flatMap(({ group }) => group.children.filter((o) => o.isMesh));
      let y = 0, vy = 0, boneError = 0, strapError = 0, penetration = 0, worst = null, maxSpeed = 0;
      let prior = null, samples = 0, fastest = null, poseDrift = 0, seatedPose;
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
          limb.boot.getWorldPosition(a);
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
      results.push({ mount: mount.id, fps, boneError, strapError, penetration, worst, maxSpeed, fastest, samples, poseDrift });
    }
    return results;
  });
  for (const result of results) {
    expect(result.boneError, JSON.stringify(result)).toBeLessThan(1e-8);
    expect(result.poseDrift, JSON.stringify(result)).toBeLessThan(1e-10);
    expect(result.strapError, JSON.stringify(result)).toBeLessThan(1e-8);
    expect(result.penetration, JSON.stringify(result.worst)).toBeLessThan(0.005);
    expect(result.maxSpeed, JSON.stringify(result)).toBeLessThan(8);
    if (result.fps === 60) expect(result.samples).toBeGreaterThan(500);
  }
});
