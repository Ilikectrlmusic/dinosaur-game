import { test, expect } from "@playwright/test";
import { CONFIG, speedAtTime } from "../src/rules.js";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});

test("survive staggered obstacles and two fire milestones in each difficulty, then verify wrong bird actions and retry", async ({ page }, testInfo) => {
  test.setTimeout(240000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /WebGLProgram|shader error|VALIDATE_STATUS/.test(message.text())) errors.push(message.text());
  });
  await page.clock.install({ time: new Date("2026-10-19T08:00:00Z") });
  // Render the real opening normally. During long simulated runs, omit only
  // drawing; the game loop, spawning, controls, collision and physics still run.
  await page.route("**/src/main.js*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain("renderer.render(world.scene, camera);");
    await route.fulfill({
      response,
      body: source.replaceAll(
        "renderer.render(world.scene, camera);",
        "if (!window.__skipGraphics) renderer.render(world.scene, camera);",
      ),
    });
  });
  await page.addInitScript(() => localStorage.setItem(
    "saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: false }),
  ));
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await page.evaluate(() => { window.__skipGraphics = true; });
  await page.clock.fastForward(1000);
  await expect(page.locator("#loading")).toHaveCount(0);

  const cactusModels = await page.evaluate(async () => {
    const source = await (await fetch("/src/main.js")).text();
    const threeURL = source.match(/import \* as THREE from "([^"]+)"/)[1];
    const { Box3 } = await import(threeURL);
    const { buildCactus } = await import("/src/creatures.js");
    return [1.05, 1.55, 2.05].map((height) => {
      const model = buildCactus(height);
      const bounds = new Box3().setFromObject(model);
      return { height, min: bounds.min.y, max: bounds.max.y };
    });
  });
  for (const model of cactusModels) {
    expect(model.min).toBeCloseTo(-0.16, 5);
    expect(model.max).toBeCloseTo(model.height, 5);
  }
  await page.evaluate(() => {
    let seed = 49217;
    Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));

  for (const difficulty of Object.keys(CONFIG)) {
    await page.locator(`[data-difficulty="${difficulty}"]`).tap();
    await page.locator("#start-button").tap();
    const seen = new Set();
    const speeds = [];
    const failOn = difficulty === "normal" ? "low" : difficulty === "hard" ? "high" : null;
    let ducking = false, failure = null, pauseChecked = false, switchedToFirst = false;
    const activeBursts = new Set(), captured = new Set();
    let previousMilestone = 0;
    let state = await page.evaluate(() => window.__saurian.state);
    while (state.distance < (failOn ? 2600 : 2250)) {
      const next = state.obstacles.filter((o) => o.z < 0.8).sort((a, b) => b.z - a.z)[0];
      const eta = next ? -next.z / (state.speed + (next.type === "bird" ? 2.5 : 0)) : Infinity;
      if (next && eta < 0.8) seen.add(`${next.type}:${next.variant}`);
      if (state.distance >= 2150 && next?.type === "bird" && next.variant === failOn && eta < 0.8)
        failure = failOn;
      const wrongAction = !!failure;
      const shouldDuck = next?.type === "bird" && eta < 0.8 &&
        (wrongAction ? failure === "low" : next.variant === "high");
      if (shouldDuck !== ducking) {
        if (shouldDuck) await page.keyboard.down("ArrowDown");
        else await page.keyboard.up("ArrowDown");
        ducking = shouldDuck;
      }
      const shouldJump = next && eta <= 0.5 && state.y < 0.01 &&
        (wrongAction ? failure === "high" : next.type === "cactus" || next.variant === "low");
      if (shouldJump) await page.keyboard.press("Space");
      await page.clock.runFor(100);
      state = await page.evaluate(() => window.__saurian.state);
      if (state.distance < 150) expect(state.obstacles.every((obstacle) => obstacle.type === "cactus")).toBe(true);
      if (state.distance < 300) expect(state.obstacles.every((obstacle) => obstacle.variant !== "triple")).toBe(true);
      if (state.mode !== "running") {
        expect(failure, `unexpected collision: ${JSON.stringify(state)}`).toBeTruthy();
        break;
      }
      expect(state.fire.bursts).toBe(Math.floor(state.distance / 1000));
      if (state.milestone > previousMilestone) {
        await expect(page.locator("#distance")).toHaveClass(/milestone-flash/);
        await expect(page.locator("#distance")).toHaveCSS("animation-name", "milestone-pulse");
        previousMilestone = state.milestone;
      }
      if (state.fire.particles > 10) activeBursts.add(state.fire.bursts);
      if (difficulty === "easy" && state.distance > 1900 && !switchedToFirst) {
        await page.keyboard.press("v");
        switchedToFirst = true;
      }
      if (difficulty === "easy" && state.fire.strength > 0.8 && state.fire.particles > 20 && !captured.has(state.milestone)) {
        await page.evaluate(() => { window.__skipGraphics = false; });
        await page.clock.runFor(32);
        const path = testInfo.outputPath(`fire-${state.milestone}-${state.view}.png`);
        await page.screenshot({ path, animations: "allow" });
        console.log(`Fire visual: ${path}`);
        expect(await page.evaluate(() => window.__saurian.renderer.programs.every((program) => program.diagnostics?.runnable !== false))).toBe(true);
        await page.evaluate(() => { window.__skipGraphics = true; });
        captured.add(state.milestone);
        if (state.milestone === 1) {
          await page.locator("#pause-button").tap();
          const frozen = await page.evaluate(() => window.__saurian.state.fire);
          await page.clock.runFor(1000);
          expect(await page.evaluate(() => window.__saurian.state.fire)).toEqual(frozen);
          await page.locator("#resume-button").tap();
        }
        state = await page.evaluate(() => window.__saurian.state);
      }
      if (speeds.length === 0 || state.runTime > speeds.at(-1).time + 10)
        speeds.push({ time: state.runTime, speed: state.speed });
      if (!pauseChecked && state.runTime > 10) {
        await page.locator("#pause-button").tap();
        const before = await page.evaluate(() => window.__saurian.state);
        await page.clock.runFor(2000);
        const after = await page.evaluate(() => window.__saurian.state);
        expect(after.speed).toBe(before.speed);
        expect(after.runTime).toBe(before.runTime);
        await page.locator("#resume-button").tap();
        pauseChecked = true;
      }
    }
    expect([...seen].sort()).toEqual(["bird:high", "bird:low", "cactus:medium", "cactus:small", "cactus:tall", "cactus:triple"]);
    expect(speeds[2].speed).toBeGreaterThan(speeds[1].speed);
    expect(speeds.at(-1).speed).toBeLessThanOrEqual(CONFIG[difficulty].maxSpeed);
    expect(speeds.at(-1).speed).toBeGreaterThan(CONFIG[difficulty].speed + 8);
    expect(state.speed).toBeCloseTo(speedAtTime(difficulty, state.runTime), 8);
    expect([...activeBursts]).toEqual([1, 2]);
    if (difficulty === "easy") expect([...captured]).toEqual([1, 2]);
    await page.keyboard.up("ArrowDown");
    if (failOn) {
      expect(failure).toBe(failOn);
      await page.clock.runFor(3000);
      await expect(page.locator("#death-dialog")).toBeVisible();
      expect(await page.evaluate(() => window.__saurian.state.fire.active)).toBe(false);
      await expect(page.locator("#death-reason")).toContainText(failOn === "low" ? "低飞" : "高飞");
      if (difficulty === "normal") {
        await page.locator("#retry-button").tap();
        const restarted = await page.evaluate(() => window.__saurian.state);
        expect(restarted.speed).toBe(CONFIG[difficulty].speed);
        expect(restarted.physicsBodies).toBe(0);
        expect(restarted.fire.bursts).toBe(0);
      } else {
        await page.locator("#death-home").tap();
        continue;
      }
    }
    await page.locator("#pause-button").tap();
    await page.locator("#pause-home").tap();
  }
  await expect(page.locator("#menu")).toBeVisible();
  expect(errors).toEqual([]);
});

test("triple cacti render as three plants and retain three physical colliders during a crash", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("saurian-preferences", JSON.stringify({ quality: "low", sound: false })));
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian);
  const result = await page.evaluate(async () => {
    const { buildDinosaur, buildCactusCluster, animateDinosaur } = await import("/src/creatures.js");
    const { CrashPhysics } = await import("/src/physics.js");
    const { chooseObstacle } = await import("/src/rules.js");
    const values = [0.9, 0, 0.9];
    const spec = chooseObstacle(300, () => values.shift());
    const dino = buildDinosaur();
    const scene = new dino.root.constructor();
    scene.add(dino.root);
    animateDinosaur(dino, 0);
    const cluster = buildCactusCluster(spec.members);
    cluster.userData = spec;
    cluster.position.z = -1;
    scene.add(cluster);
    const source = await (await fetch("/src/main.js")).text();
    const { Box3 } = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const heights = cluster.children.map((plant) => {
      const bounds = new Box3().setFromObject(plant);
      return bounds.max.y;
    });
    const plants = cluster.children.map((plant) => plant.position.toArray());
    const physics = new CrashPhysics(scene, dino, 20, cluster);
    const collider = physics.world.bodies.find((body) => body.mass === 0 && body.shapes.length === 3);
    const offsets = collider?.shapeOffsets.map((position) => [position.x, position.y, position.z]);
    for (let i = 0; i < 360; i++) physics.update(1 / 120);
    const result = {
      plants, heights, offsets,
      finite: physics.world.bodies.every((body) => [body.position.x, body.position.y, body.position.z, body.quaternion.w].every(Number.isFinite)),
      mountY: physics.centerBody.position.y,
    };
    physics.dispose();
    return result;
  });
  expect(result.plants).toEqual([[0, 0, 0], [0, 0, -1.05], [0, 0, -2.1]]);
  result.heights.forEach((height, i) => expect(height).toBeCloseTo([2.05, 1.05, 1.55][i], 5));
  expect(result.offsets).toEqual([[0, 1.025, 0], [0, 0.525, -1.05], [0, 0.775, -2.1]]);
  expect(result.finite).toBe(true);
  expect(result.mountY).toBeGreaterThan(0);
  expect(result.mountY).toBeLessThan(1.5);
});
