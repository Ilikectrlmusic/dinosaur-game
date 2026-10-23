import { test, expect } from "@playwright/test";

async function openGame(page) {
  await page.clock.install();
  await page.route("**/src/main.js*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll(
      "renderer.render(world.scene, camera);", "if (!window.__skipGraphics) renderer.render(world.scene, camera);",
    ) });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem("saurian-preferences"))
      localStorage.setItem("saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: false }));
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await page.evaluate(() => { window.__skipGraphics = true; });
  await page.clock.fastForward(1500);
  await expect(page.locator("#loading")).toHaveCount(0);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10000));
}

test("mount selection survives rider changes, reload, retry and camp without overlapping the camp controls", async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openGame(page);
  await expect(page.locator("[data-mount]")).toHaveCount(3);
  for (const id of ["carnotaurus", "dilophosaurus", "allosaurus", "dilophosaurus"]) {
    await page.locator(`[data-mount="${id}"]`).click();
    expect(await page.evaluate(() => window.__saurian.state.mount)).toBe(id);
    await expect(page.locator(`[data-mount="${id}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  await page.locator('[data-rider="2"]').click();
  expect(await page.evaluate(() => window.__saurian.state.mount)).toBe("dilophosaurus");
  await page.reload();
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await page.evaluate(() => { window.__skipGraphics = true; });
  await page.clock.runFor(6000);
  await expect(page.locator("#loading")).toHaveCount(0);
  expect(await page.evaluate(() => [window.__saurian.state.mount, window.__saurian.state.rider])).toEqual(["dilophosaurus", 2]);
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [900, 650], [800, 600], [390, 844], [320, 740], [320, 568]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const mount = box(".mount-options"), footer = box(".footer"), record = box(".camp-record");
      return {
        footerGap: footer.top - record.bottom,
        introGap: box(".expedition").top - box(".intro").bottom,
        buttonHits: [...document.querySelectorAll("[data-mount]")].every((button) => {
          const rect = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }),
        fits: mount.left >= 0 && mount.right <= innerWidth,
      };
    });
    // Browser font metrics can differ by a fraction of a CSS pixel.
    expect(Math.round(layout.footerGap), JSON.stringify({ width, height, ...layout })).toBeGreaterThanOrEqual(16);
    expect(layout.introGap).toBeGreaterThanOrEqual(7);
    expect(layout.fits && layout.buttonHits).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-difficulty="hard"]').click();
  await page.locator("#start-button").click();
  for (let i = 0; i < 100 && await page.evaluate(() => window.__saurian.state.mode === "running"); i++) await page.clock.runFor(100);
  await page.clock.runFor(3000);
  await expect(page.locator("#death-dialog")).toBeVisible();
  await page.locator("#retry-button").click();
  expect(await page.evaluate(() => window.__saurian.state.mount)).toBe("dilophosaurus");
  await page.locator("#pause-button").click();
  await page.locator("#pause-home").click();
  await expect(page.locator('[data-mount="dilophosaurus"]')).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("upper-body joints articulate continuously during running, jumping and landing for every mount", async ({ page }) => {
  await openGame(page);
  const samples = await page.evaluate(async () => {
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const { advanceJump, JUMP_VELOCITY } = await import("/src/rules.js");
    const result = [];
    for (const mount of MOUNTS) for (const fps of [30, 60, 120]) {
      const dino = buildDinosaur(0, mount.id), dt = 1 / fps;
      const ranges = dino.forelimbs.map(() => ({ min: Infinity, max: -Infinity, previous: null }));
      let y = 0, vy = 0, fastest = 0, maxFlex = 0, attached = true;
      let previousNod, maxNodSpeed = 0, neckRange = [Infinity, -Infinity], headRange = [Infinity, -Infinity];
      for (let frame = 0; frame < fps * 2; frame++) {
        if (frame === Math.round(fps * 0.4)) vy = JUMP_VELOCITY;
        ({ y, vy } = advanceJump(y, vy, dt));
        dino.root.position.y = y;
        animateDinosaur(dino, frame * dt, 1, 0, y, dt, 0, vy);
        // Measure the actual skull/neck transforms, excluding the whole
        // animal's flight, rather than testing an unused animation offset.
        const neckY = dino.neck.position.y;
        const headY = (dino.head.matrixWorld.elements[13] - y) / dino.sizeScale;
        if (frame < fps * 0.4) {
          neckRange = [Math.min(neckRange[0], neckY), Math.max(neckRange[1], neckY)];
          headRange = [Math.min(headRange[0], headY), Math.max(headRange[1], headY)];
        }
        if (previousNod) maxNodSpeed = Math.max(maxNodSpeed, Math.abs(neckY - previousNod[0]) / dt, Math.abs(headY - previousNod[1]) / dt);
        previousNod = [neckY, headY];
        dino.forelimbs.forEach(({ shoulder, elbow }, i) => {
          const range = ranges[i], values = [shoulder.rotation.x, shoulder.rotation.z, elbow.rotation.x];
          range.min = Math.min(range.min, values[0]); range.max = Math.max(range.max, values[0]);
          if (range.previous) values.forEach((value, j) => { fastest = Math.max(fastest, Math.abs(value - range.previous[j]) / dt); });
          range.previous = values;
          maxFlex = Math.max(maxFlex, Math.abs(elbow.rotation.x));
          attached &&= shoulder.parent === dino.body && elbow.parent === shoulder && dino.head.parent === dino.neck;
        });
      }
      result.push({ mount: mount.id, fps, swing: Math.min(...ranges.map((r) => r.max - r.min)), fastest, maxFlex, attached,
        neckRange: neckRange[1] - neckRange[0], headRange: headRange[1] - headRange[0], maxNodSpeed });
    }
    return result;
  });
  for (const sample of samples) {
    expect(sample.attached, JSON.stringify(sample)).toBe(true);
    expect(sample.swing).toBeGreaterThan(0.06);
    expect(sample.fastest).toBeLessThan(3);
    expect(sample.maxFlex).toBeGreaterThan(0.04);
    expect(sample.maxFlex).toBeLessThan(0.25);
    expect(sample.neckRange).toBeGreaterThan(0.02);
    expect(sample.neckRange).toBeLessThan(0.14);
    expect(sample.headRange).toBeGreaterThan(sample.neckRange * 0.8);
    expect(sample.headRange).toBeLessThan(sample.neckRange * 1.5);
    expect(sample.maxNodSpeed).toBeLessThan(4);
  }
});

test("mounts have subtly decreasing body sizes while every rider keeps the same size and seat height", async ({ page }) => {
  await openGame(page);
  const sizes = await page.evaluate(async () => {
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const source = await (await fetch("/src/main.js")).text();
    const { Box3, Vector3 } = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    return MOUNTS.map((mount) => {
      const dino = buildDinosaur(0, mount.id);
      dino.setRider(2);
      animateDinosaur(dino, 1, 1, 0, 0, 0);
      // Compare the torso itself; the species keep different arm lengths.
      const torso = new Box3();
      for (const part of dino.body.children)
        if (part.isMesh) torso.union(new Box3().setFromObject(part, true));
      const body = torso.getSize(new Vector3());
      const rider = new Box3().setFromObject(dino.rider.root, true).getSize(new Vector3());
      const seatOffset = dino.rider.pelvis.getWorldPosition(new Vector3()).sub(dino.saddle.getWorldPosition(new Vector3()));
      return { id: mount.id, body: body.toArray(), volume: body.x * body.y * body.z, rider: rider.toArray(), seatOffset: seatOffset.toArray() };
    });
  });
  expect(sizes.map((mount) => mount.id)).toEqual(["allosaurus", "carnotaurus", "dilophosaurus"]);
  for (let i = 1; i < sizes.length; i++) {
    expect(sizes[i - 1].body[1]).toBeGreaterThan(sizes[i].body[1] * 1.04);
    expect(sizes[i - 1].body[2]).toBeGreaterThan(sizes[i].body[2] * 1.04);
    expect(sizes[i - 1].volume).toBeGreaterThan(sizes[i].volume);
    sizes[i].rider.forEach((value, axis) => expect(value).toBeCloseTo(sizes[0].rider[axis], 6));
    sizes[i].seatOffset.forEach((value, axis) => expect(value).toBeCloseTo(sizes[0].seatOffset[axis], 6));
  }
  expect(sizes[0].body[1] / sizes[2].body[1]).toBeLessThan(1.18);
  expect(sizes[0].body[2] / sizes[2].body[2]).toBeLessThan(1.18);
});

test("every mount rolls its feet without sinking and lands one foot at a time with the rider seated", async ({ page }) => {
  await openGame(page);
  const results = await page.evaluate(async () => {
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const { advanceJump, JUMP_VELOCITY } = await import("/src/rules.js");
    const source = await (await fetch("/src/main.js")).text();
    const { Box3, Vector3 } = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const results = [];
    for (const [index, mount] of MOUNTS.entries()) for (const fps of [30, 60, 120]) {
      const dino = buildDinosaur(index, mount.id), dt = 1 / fps;
      const bounds = new Box3(), point = new Vector3(), seat = new Vector3();
      let y = 0, vy = 0, baseline, seatError = 0, reinError = 0;
      let minClearance = Infinity, maxClearance = -Infinity, minPitch = Infinity, maxPitch = -Infinity, boneError = 0;
      let minFlightExtension = Infinity, maxFlightExtension = 0, extendedSamples = 0, maxImpactHipSpeed = 0;
      const previousHipAngles = [NaN, NaN];
      const landings = [];
      for (let frame = 0; frame < fps * 2; frame++) {
        if (frame === Math.round(fps * 0.3)) vy = JUMP_VELOCITY;
        const jump = advanceJump(y, vy, dt);
        y = jump.y; vy = jump.vy;
        dino.root.position.y = y;
        animateDinosaur(dino, frame * dt, 1, 0, y, dt, 0, vy);
        const pose = dino.gait.pose;
        if (pose.landingContacts) landings.push({ time: frame * dt, mask: pose.landingContacts });
        for (const [i, leg] of dino.legs.entries()) {
          if (pose.mode === "landing" && dino.gait.landingAge < 0.1 && Number.isFinite(previousHipAngles[i]))
            maxImpactHipSpeed = Math.max(maxImpactHipSpeed, Math.abs(leg.hip.rotation.x - previousHipAngles[i]) / dt);
          previousHipAngles[i] = leg.hip.rotation.x;
          // The knee and ankle now articulate without changing calf length.
          leg.foot.getWorldPosition(point);
          leg.shin.getWorldPosition(seat);
          boneError = Math.max(boneError, Math.abs(point.distanceTo(seat) - leg.shinLength * dino.sizeScale));
          boneError = Math.max(boneError, leg.shin.scale.distanceTo(new Vector3(1, 1, 1)));
          const flightAge = frame * dt - 0.3;
          if (flightAge > 0.38 && flightAge < 0.68) {
            leg.hip.getWorldPosition(seat);
            const extension = point.distanceTo(seat) / ((leg.thighLength + leg.shinLength) * dino.sizeScale);
            minFlightExtension = Math.min(minFlightExtension, extension);
            maxFlightExtension = Math.max(maxFlightExtension, extension);
            extendedSamples++;
          }
          const clearance = bounds.setFromObject(leg.foot, true).min.y - y - pose.legs[i].lift * dino.sizeScale;
          minClearance = Math.min(minClearance, clearance);
          maxClearance = Math.max(maxClearance, clearance);
          if (pose.mode === "running") {
            const pitch = leg.hip.rotation.x + leg.foot.rotation.x;
            minPitch = Math.min(minPitch, pitch); maxPitch = Math.max(maxPitch, pitch);
          }
        }
        dino.saddle.worldToLocal(dino.rider.pelvis.getWorldPosition(seat));
        baseline ??= seat.clone();
        seatError = Math.max(seatError, seat.distanceTo(baseline));
        for (let i = 0; i < 2; i++) {
          dino.root.worldToLocal(dino.rider.limbs[i].hand.getWorldPosition(point));
          reinError = Math.max(reinError, point.distanceTo(dino.reins[i].points[0]));
        }
      }
      results.push({ mount: mount.id, fps, minClearance, maxClearance, minPitch, maxPitch, boneError, minFlightExtension, maxFlightExtension, extendedSamples, maxImpactHipSpeed, seatError, reinError, landings });
    }
    return results;
  });
  expect(results).toHaveLength(9);
  for (const result of results) {
    expect(result.minClearance, JSON.stringify(result)).toBeGreaterThan(0.002);
    expect(result.maxClearance, JSON.stringify(result)).toBeLessThan(0.004);
    expect(result.minPitch).toBeLessThan(-0.49);
    expect(result.maxPitch).toBeGreaterThan(0.17);
    expect(result.boneError).toBeLessThan(1e-8);
    expect(result.maxImpactHipSpeed, JSON.stringify(result)).toBeLessThan(9);
    expect(result.extendedSamples).toBeGreaterThan(12);
    expect(result.minFlightExtension).toBeGreaterThan(0.99);
    expect(result.maxFlightExtension).toBeLessThan(1);
    expect(result.seatError).toBeLessThan(1e-8);
    expect(result.reinError).toBeLessThan(1e-8);
    expect(result.landings).toHaveLength(2);
    expect(result.landings[0].mask).not.toBe(result.landings[1].mask);
    expect(Math.abs(result.landings[1].time - result.landings[0].time - 0.14)).toBeLessThanOrEqual(1 / result.fps + 1e-9);
  }
});

test("all species keep the saddle and reins connected, clear visible cactus gaps, breathe from the mouth and settle after a crash", async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const results = await page.evaluate(async () => {
    const { buildDinosaur, animateDinosaur, cactusContactBounds, buildCactus } = await import("/src/creatures.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const { overlapsRunner } = await import("/src/rules.js");
    const { FireBreath } = await import("/src/fire-breath.js");
    const { CrashPhysics } = await import("/src/physics.js");
    const source = await (await fetch("/src/main.js")).text();
    const { Scene, Box3, Vector3 } = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const results = [];
    for (const mount of MOUNTS) for (const rider of [0, 1, 2]) {
      const dino = buildDinosaur(rider, mount.id), scene = new Scene();
      scene.add(dino.root);
      const seats = [], reins = [];
      for (const duck of [0, .5, 1, 0]) {
        animateDinosaur(dino, 1.2, 1, duck);
        seats.push(dino.saddle.worldToLocal(dino.rider.pelvis.getWorldPosition(new Vector3())).toArray());
        reins.push(...dino.reins.map((rein, i) => [
          rein.points[0].distanceTo(dino.root.worldToLocal(dino.rider.limbs[i].hand.getWorldPosition(new Vector3()))),
          rein.points.at(-1).distanceTo(dino.root.worldToLocal(dino.reinAnchors[i].getWorldPosition(new Vector3()))),
        ]));
      }
      const headBounds = new Box3().setFromObject(dino.head, true);
      dino.root.position.y = 1;
      animateDinosaur(dino, 1.2, 1, 0, 1);
      const bottom = Math.min(...cactusContactBounds(dino).map((bounds) => bounds.min.y));
      dino.root.position.y += 2.06 - bottom;
      const clear = [-1, -.5, 0, .5, 1].every((z) => !overlapsRunner({ x: 0, y: dino.root.position.y, duck: 0, cactusBounds: cactusContactBounds(dino) }, { type: "cactus", x: 0, z, height: 2.05 }));
      const fire = new FireBreath(scene);
      fire.start(); fire.update(.15, dino.head, 20);
      const mouthError = fire.origin.distanceTo(dino.head.localToWorld(new Vector3(0, -.24, -1.12)));
      const fireAlive = fire.alive;
      fire.stop();
      dino.root.position.y = 0;
      animateDinosaur(dino, 1.2, 1);
      const cactus = buildCactus(1.55);
      cactus.position.z = -1;
      cactus.userData = { type: "cactus", height: 1.55 };
      scene.add(cactus);
      const physics = new CrashPhysics(scene, dino, 20, cactus);
      for (let i = 0; i < 360; i++) physics.update(1 / 120);
      results.push({
        mount: mount.id, rider, seats, reins, clear, mouthError, fireAlive,
        headProportions: headBounds.getSize(new Vector3()).divideScalar(dino.sizeScale).toArray(),
        finite: physics.world.bodies.every((body) => [body.position.x, body.position.y, body.position.z, body.quaternion.w].every(Number.isFinite)),
        height: physics.centerBody.position.y,
      });
      physics.dispose();
    }
    return results;
  });
  expect(results).toHaveLength(9);
  for (const result of results) {
    expect(result.clear, `${result.mount}/${result.rider}`).toBe(true);
    expect(result.mouthError).toBeLessThan(1e-8);
    expect(result.fireAlive).toBeGreaterThan(10);
    expect(result.finite).toBe(true);
    expect(result.height).toBeGreaterThan(0);
    expect(result.height).toBeLessThan(1.5);
    for (const seat of result.seats) seat.forEach((value, i) => expect(value).toBeCloseTo(result.seats[0][i], 6));
    expect(result.reins.flat().every((error) => error < 1e-8)).toBe(true);
  }
  const allo = results.find((result) => result.mount === "allosaurus");
  const carno = results.find((result) => result.mount === "carnotaurus");
  const dilo = results.find((result) => result.mount === "dilophosaurus");
  expect(carno.headProportions[0]).toBeGreaterThan(allo.headProportions[0] * 1.5);
  expect(dilo.headProportions[1]).toBeGreaterThan(allo.headProportions[1] * 1.15);
  expect(dilo.headProportions[2]).toBeGreaterThan(allo.headProportions[2] * 1.1);
});

test("tail ridge bases stay embedded in the animated skin for all mounts", async ({ page }) => {
  await openGame(page);
  const results = await page.evaluate(async () => {
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { MOUNTS } = await import("/src/mounts.js");
    const source = await (await fetch("/src/main.js")).text();
    const { Raycaster, Vector3, Matrix3 } = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    return MOUNTS.map((mount) => {
      const dino = buildDinosaur(0, mount.id), ray = new Raycaster(), normalMatrix = new Matrix3();
      const skins = dino.tail.map((joint) => joint.children.find((mesh) => mesh.name === "tail-skin"));
      let samples = 0, misses = 0, maxGap = -Infinity;
      for (let frame = 0; frame < 160; frame++) {
        const age = frame / 60;
        const height = frame >= 30 && frame < 85 ? Math.max(0, 10.5 * (age - 0.5) - 11 * (age - 0.5) ** 2) : 0;
        dino.root.position.y = height;
        animateDinosaur(dino, age, 1, frame > 120 ? 1 : 0, height, 1 / 60, 0, height ? 10.5 - 22 * (age - 0.5) : 0);
        dino.root.updateMatrixWorld(true);
        if (frame % 8) continue;
        for (const joint of dino.tail) for (const mesh of joint.children) {
          if (!mesh.isMesh || mesh.name === "tail-skin") continue;
          normalMatrix.getNormalMatrix(mesh.matrixWorld);
          const positions = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
          for (let i = 0; i < positions.count; i++) {
            if (normals.getY(i) > -0.9) continue; // actual underside of each plate
            const point = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
            const down = new Vector3().fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
            ray.set(point.addScaledVector(down, -0.2), down);
            const hit = ray.intersectObjects(skins, false)[0];
            samples++;
            if (!hit) misses++;
            else maxGap = Math.max(maxGap, hit.distance - 0.2);
          }
        }
      }
      return { mount: mount.id, samples, misses, maxGap };
    });
  });
  for (const result of results) {
    expect(result.samples).toBeGreaterThan(1000);
    expect(result.misses, JSON.stringify(result)).toBe(0);
    expect(result.maxGap, JSON.stringify(result)).toBeLessThan(-0.005);
    expect(result.maxGap).toBeGreaterThan(-0.04);
  }
});
