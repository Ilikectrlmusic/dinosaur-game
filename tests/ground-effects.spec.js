import { test, expect } from "@playwright/test";

async function advanceUntil(page, predicate) {
  await expect.poll(async () => {
    await page.clock.runFor(50);
    return page.evaluate(predicate);
  }, { timeout: 15000, intervals: [25, 50, 100] }).toBe(true);
}

for (const mobile of [false, true]) test.describe(mobile ? "phone sand contacts" : "desktop sand contacts", () => {
  test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  test("every mount raises dust only on contact, leaves grounded tracks and clears them on returning to camp", async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /Shader Error|WebGLProgram|VALIDATE_STATUS/.test(message.text())) errors.push(message.text());
    });
    await page.clock.install();
    await page.route("**/src/main.js*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replaceAll(
        "renderer.render(world.scene, camera);", "if (!window.__skipGraphics) renderer.render(world.scene, camera);",
      ).replace("// A small read-only diagnostic surface", "window.__effectsReview = { world, renderer, camera }; // A small read-only diagnostic surface") });
    });
    await page.addInitScript(() => localStorage.setItem("saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: false, difficulty: "easy" })));
    await page.goto("/");
    await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
    await page.evaluate(() => { window.__skipGraphics = true; });
    await page.clock.fastForward(5000);
    await expect.poll(async () => { await page.clock.runFor(250); return page.locator("#loading").count(); }).toBe(0);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const render = () => page.evaluate(() => {
      const { world, renderer, camera } = window.__effectsReview;
      renderer.render(world.scene, camera);
      return { active: world.groundEffects.points.visible, shadows: [...world.groundEffects.footShadows.geometry.attributes.contactOpacity.array] };
    });
    for (const mount of ["allosaurus", "carnotaurus", "dilophosaurus"]) {
      await page.locator(`[data-mount="${mount}"]`).click();
      await page.locator("#start-button").click();
      await advanceUntil(page, () => window.__saurian.state.groundEffects.emissions.run >= 2);
      expect((await render()).active).toBe(true);
      const runCount = await page.evaluate(() => window.__saurian.state.groundEffects.emissions.run);
      if (mobile) await page.locator("#touch-jump").tap();
      else await page.keyboard.press("Space");
      await advanceUntil(page, () => window.__saurian.state.y > 2);
      const airborne = await page.evaluate(() => window.__saurian.state.groundEffects);
      expect(airborne.emissions).toMatchObject({ run: runCount, takeoff: 1, landing: 0 });
      expect(Math.abs(airborne.lastImpact.x)).toBeGreaterThan(0.4);
      expect(airborne.lastImpact.y).toBeCloseTo(-0.04, 5);
      expect((await render()).shadows.every((alpha) => alpha < 0.01)).toBe(true);
      await advanceUntil(page, () => window.__saurian.state.groundEffects.emissions.landing === 2);
      const landed = await page.evaluate(() => window.__saurian.state.groundEffects);
      expect(landed.particles).toBeLessThanOrEqual(144);
      expect(landed.footprints).toBeGreaterThanOrEqual(3);
      expect((await render()).active).toBe(true);
      await page.locator("#pause-button").click();
      const frozen = await page.evaluate(() => ({ state: window.__saurian.state.groundEffects,
        positions: [...window.__effectsReview.world.groundEffects.positions] }));
      await page.clock.runFor(500);
      expect(await page.evaluate(() => ({ state: window.__saurian.state.groundEffects,
        positions: [...window.__effectsReview.world.groundEffects.positions] }))).toEqual(frozen);
      await page.locator("#pause-home").click();
      expect(await page.evaluate(() => window.__saurian.state.groundEffects)).toMatchObject({ particles: 0, footprints: 0,
        emissions: { run: 0, takeoff: 0, landing: 0, crash: 0 } });
    }
    expect(errors).toEqual([]);
  });
});
