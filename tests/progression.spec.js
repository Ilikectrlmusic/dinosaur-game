import { test, expect } from "@playwright/test";
import { CONFIG } from "../src/rules.js";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});

test("original rules: survive acceleration and all obstacle heights, then verify wrong bird actions and retry", async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
    expect(model.min).toBeCloseTo(0, 5);
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
    let ducking = false, failure = null, pauseChecked = false;
    let state = await page.evaluate(() => window.__saurian.state);
    while (state.runTime < (failOn ? 130 : 95)) {
      const next = state.obstacles.filter((o) => o.z < 0.8).sort((a, b) => b.z - a.z)[0];
      const eta = next ? -next.z / (state.speed + (next.type === "bird" ? 2.5 : 0)) : Infinity;
      if (next && eta < 0.8) seen.add(`${next.type}:${next.variant}`);
      if (state.runTime >= 95 && next?.type === "bird" && next.variant === failOn && eta < 0.8)
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
      if (state.mode !== "running") {
        expect(failure, `unexpected collision: ${JSON.stringify(state)}`).toBeTruthy();
        break;
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
    expect([...seen].sort()).toEqual(["bird:high", "bird:low", "cactus:medium", "cactus:small", "cactus:tall"]);
    expect(speeds[2].speed).toBeGreaterThan(speeds[1].speed);
    expect(speeds.at(-1).speed).toBe(CONFIG[difficulty].maxSpeed);
    await page.keyboard.up("ArrowDown");
    if (failOn) {
      expect(failure).toBe(failOn);
      await page.clock.runFor(3000);
      await expect(page.locator("#death-dialog")).toBeVisible();
      await expect(page.locator("#death-reason")).toContainText(failOn === "low" ? "低飞" : "高飞");
      if (difficulty === "normal") {
        await page.locator("#retry-button").tap();
        const restarted = await page.evaluate(() => window.__saurian.state);
        expect(restarted.speed).toBe(CONFIG[difficulty].speed);
        expect(restarted.physicsBodies).toBe(0);
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
