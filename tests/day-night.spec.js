import { test, expect } from "@playwright/test";

test("every rider holds the night torch, gathers the reins and keeps the fire attached on every mount", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/?torch-rig", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/?torch-rig");
  const cases = await page.evaluate(async () => {
    const source = await (await fetch("/src/main.js")).text();
    const T = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const { buildDinosaur, animateDinosaur } = await import("/src/creatures.js");
    const { RiderTorch } = await import("/src/rider-torch.js");
    const results = [], point = new T.Vector3(), left = new T.Vector3(), head = new T.Vector3();
    for (const mount of ["allosaurus", "carnotaurus", "dilophosaurus"]) for (let rider = 0; rider < 3; rider++) {
      const dino = buildDinosaur(rider, mount), scene = new T.Scene(), torch = new RiderTorch(scene);
      scene.add(dino.root); dino.torchAmount = 1;
      if (rider > 0) dino.torchPose = 1;
      let pinError = 0, reinError = 0, maxStretch = 0, raised = Infinity, ropeBound = 0, crouchedFireTop = 0, crouchedLightHeight = Infinity;
      for (let frame = 0; frame < 240; frame++) {
        const time = frame / 60;
        const duck = time > 2 ? Math.sin((time - 2) / 2 * Math.PI) ** 2 : 0;
        animateDinosaur(dino, time, 1, duck, 0, 1 / 60);
        torch.update(1 / 60, dino.rider.limbs[1].hand, dino.torchPose, time, { speed: 18, duck });
        for (const rein of dino.reins) for (const p of rein.points) ropeBound = Math.max(ropeBound, p.length());
        dino.rider.limbs[1].hand.getWorldPosition(point);
        pinError = Math.max(pinError, torch.root.position.distanceTo(point));
        if (time > 1.8) {
          dino.rider.head.getWorldPosition(head);
          if (duck < 0.2) raised = Math.min(raised, torch.origin.y - head.y);
          if (duck > 0.995) crouchedFireTop = Math.max(crouchedFireTop,
            torch.flame.localToWorld(new T.Vector3(0, 0.6 * torch.flameMaterial.uniforms.stretch.value + 0.16, 0)).y);
          dino.root.worldToLocal(dino.rider.limbs[0].hand.getWorldPosition(left));
          reinError = Math.max(reinError, dino.reins[1].points[0].distanceTo(left));
          for (const rein of dino.reins) {
            const length = rein.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(rein.points[i]), 0);
            maxStretch = Math.max(maxStretch, length / Math.max(rein.length, rein.points[0].distanceTo(rein.points.at(-1))));
          }
        }
      }
      for (const speed of [10, 36]) for (let frame = 0; frame < 90; frame++) {
        const time = 5 + frame / 60;
        animateDinosaur(dino, time, 1, 1, 0, 1 / 60);
        torch.update(1 / 60, dino.rider.limbs[1].hand, 1, time, { speed, duck: 1 });
        dino.rider.head.getWorldPosition(head);
        crouchedFireTop = Math.max(crouchedFireTop,
          torch.flame.localToWorld(new T.Vector3(0, 0.6 * torch.flameMaterial.uniforms.stretch.value + 0.16, 0)).y);
        crouchedLightHeight = Math.min(crouchedLightHeight, torch.origin.y - head.y);
      }
      results.push({ mount, rider, pinError, reinError, maxStretch, raised, ropeBound, crouchedFireTop, crouchedLightHeight, lit: torch.light.intensity, particles: torch.alive });
    }
    return results;
  });
  for (const result of cases) {
    expect(result.pinError, JSON.stringify(result)).toBeLessThan(1e-8);
    expect(result.reinError, JSON.stringify(result)).toBeLessThan(0.001);
    expect(result.maxStretch, JSON.stringify(result)).toBeLessThan(1.4);
    expect(result.raised, JSON.stringify(result)).toBeGreaterThan(0.25);
    expect(result.crouchedFireTop, JSON.stringify(result)).toBeLessThan(3.2);
    expect(result.crouchedLightHeight, JSON.stringify(result)).toBeGreaterThan(0.1);
    expect(result.ropeBound, JSON.stringify(result)).toBeLessThan(5);
    expect(result.lit).toBeGreaterThan(0);
    expect(result.particles).toBeLessThanOrEqual(24);
  }
});

test("day and night update the environment and UI, pause with the game, and keep the torch in both views", async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Shader Error|WebGLProgram|VALIDATE_STATUS/.test(message.text())) errors.push(message.text());
  });
  await page.clock.install();
  await page.route("**/src/main.js*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replaceAll("renderer.render(world.scene, camera);", "if (!window.__skipGraphics) renderer.render(world.scene, camera);")
      .replace("// A small read-only diagnostic surface", "window.__cycleTest = { world, torch, camera, renderer, get dino(){return dino;}, setTime:(t)=>{state.time=t;} }; // A small read-only diagnostic surface") });
  });
  await page.addInitScript(() => localStorage.setItem("saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: false, difficulty: "easy" })));
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await page.evaluate(() => { window.__skipGraphics = true; });
  await page.clock.fastForward(5000);
  await expect.poll(async () => { await page.clock.runFor(250); return page.locator("#loading").count(); }).toBe(0);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const sample = async (time) => {
    await page.evaluate((t) => window.__cycleTest.setTime(t), time);
    await expect.poll(async () => {
      await page.clock.runFor(100);
      return page.evaluate(() => window.__saurian.state.daylight.time);
    }, { timeout: 10000, intervals: [20, 50, 100] }).toBeGreaterThan(time);
    await page.clock.runFor(300);
    return page.evaluate(() => ({ state: window.__saurian.state,
      sun: window.__cycleTest.world.dayNight.solarIntensity, fog: window.__cycleTest.world.scene.fog.color.toArray(),
      shadow: window.__cycleTest.torch.groundLight.castShadow }));
  };
  const day = await sample(21.6);
  expect(day.state.daylight.stage).toBe("day"); expect(day.state.torch.strength).toBe(0);
  await expect(page.locator("#weather-phase")).toHaveText("DAYLIGHT");
  const sunset = await sample(66.6);
  expect(sunset.state.daylight.stage).toBe("sunset"); expect(sunset.sun).toBeLessThan(day.sun);
  const night = await sample(111.6);
  expect(night.state.daylight.stage).toBe("night"); expect(night.state.torch.light).toBeGreaterThan(0);
  expect(night.sun).toBe(0); expect(night.fog).not.toEqual(day.fog); expect(night.shadow).toBe(false);
  await expect(page.locator("#weather-phase")).toHaveText("MOONLIT NIGHT");
  const detail = await page.evaluate(async () => {
    const { buildCactus } = await import("/src/creatures.js");
    const cycle = window.__cycleTest.world.dayNight, count = cycle.details.size, cactus = buildCactus(1.55);
    cycle.register(cactus);
    let dimmed = false;
    cactus.traverse((mesh) => {
      if (!mesh.material?.isLineBasicMaterial) return;
      dimmed = mesh.material.color.r < cycle.details.get(mesh.material).r * 0.2;
      mesh.material.dispose();
    });
    return { dimmed, released: cycle.details.size === count };
  });
  expect(detail).toEqual({ dimmed: true, released: true });
  await page.locator("#start-button").click(); await page.clock.runFor(250);
  expect(await page.evaluate(() => window.__saurian.state.torch.strength)).toBeGreaterThan(0.9);
  await page.keyboard.press("v"); await page.clock.runFor(700);
  const first = await page.evaluate(() => {
    const r = window.__cycleTest, p = r.torch.origin.clone().project(r.camera);
    r.renderer.render(r.world.scene, r.camera);
    return { visible: r.torch.root.visible, hiddenRider: !r.dino.rider.root.visible, screen: p.toArray(), light: r.torch.light.intensity };
  });
  expect(first.visible && first.hiddenRider).toBe(true); expect(first.light).toBeGreaterThan(0);
  expect(Math.abs(first.screen[0])).toBeLessThan(1); expect(Math.abs(first.screen[1])).toBeLessThan(1);
  await page.locator("#pause-button").click();
  const frozen = await page.evaluate(() => window.__saurian.state.daylight);
  await page.clock.runFor(1000); expect(await page.evaluate(() => window.__saurian.state.daylight)).toEqual(frozen);
  await page.locator("#pause-home").click();
  expect(await page.evaluate(() => window.__saurian.state.mode)).toBe("menu");
  expect((await sample(156.6)).state.daylight.stage).toBe("sunrise");
  expect((await sample(201.6)).state.torch.strength).toBeLessThan(0.15);
  await sample(111.6);
  await page.locator("#start-button").click();
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return page.evaluate(() => window.__saurian.state.mode);
  }, { timeout: 25000, intervals: [20, 50, 100] }).toBe("crashed");
  const crash = await page.evaluate(() => {
    const r = window.__cycleTest;
    const hand = r.dino.rider.limbs[1].hand.getWorldPosition(r.torch.handPosition.clone());
    r.renderer.render(r.world.scene, r.camera);
    return { attached: r.torch.root.position.distanceTo(hand), falling: r.torch.crashed,
      finite: r.torch.positions.every(Number.isFinite), issue: window.__saurian.state.crashIssue };
  });
  expect(crash).toMatchObject({ falling: true, finite: true, issue: null });
  expect(crash.attached).toBeLessThan(1e-8);
  await page.clock.runFor(3000);
  await expect(page.locator("#death-dialog")).toBeVisible();
  await page.locator("#retry-button").click();
  expect(await page.evaluate(() => window.__saurian.state.mode)).toBe("running");
  expect(errors).toEqual([]);
});
