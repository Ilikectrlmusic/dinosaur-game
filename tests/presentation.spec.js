import { test, expect } from "@playwright/test";

async function openControlledGame(page) {
  await page.clock.install({ time: new Date("2026-10-19T08:00:00Z") });
  await page.route("**/src/main.js*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll(
      "renderer.render(world.scene, camera);",
      "if (!window.__skipGraphics) renderer.render(world.scene, camera);",
    ) });
  });
  await page.route("**/src/world.js*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(
      "this.distance = 0;", "this.distance = 0; window.__testWorld = this;",
    ) });
  });
  await page.addInitScript(() => localStorage.setItem(
    "saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: false, difficulty: "easy" }),
  ));
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await page.evaluate(() => { window.__skipGraphics = true; });
  await page.clock.fastForward(1000);
  await expect(page.locator("#loading")).toHaveCount(0);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

async function layout(page) {
  return page.evaluate(() => {
    const tip = document.getElementById("game-tip");
    const view = document.getElementById("view-control");
    const hint = document.querySelector(".camera-drag-hint");
    return {
      tipBottom: innerHeight - tip.getBoundingClientRect().bottom,
      viewBottom: innerHeight - view.getBoundingClientRect().bottom,
      tipToView: view.getBoundingClientRect().top - tip.getBoundingClientRect().bottom,
      hintToControls: document.getElementById("mobile-controls").getBoundingClientRect().top - hint.getBoundingClientRect().bottom,
    };
  });
}

async function playUntil(page, seconds) {
  // WebKit can coalesce RAF callbacks; use the game's active elapsed time,
  // just as hint dismissal does, instead of assuming a wall-clock frame rate.
  for (let i = 0; i < 100; i++) {
    const state = await page.evaluate(() => window.__saurian.state);
    expect(state.mode).toBe("running");
    if (state.runTime >= seconds) return;
    await page.clock.runFor(100);
  }
  throw new Error(`The game did not reach ${seconds} seconds`);
}

for (const mobile of [false, true]) {
  test.describe(mobile ? "portrait phone" : "desktop", () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    test("opening hints fade together without shifting the view control, and reset on a new run", async ({ page }) => {
      test.setTimeout(90000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openControlledGame(page);
      await page.locator("#start-button").click();
      await page.clock.runFor(100);
      const opening = await layout(page);
      expect(opening.tipBottom).toBe(mobile ? 165 : 39);
      expect(opening.viewBottom).toBe(mobile ? 112 : 32);
      if (mobile) {
        expect(opening.tipToView).toBeGreaterThan(10);
        expect(opening.hintToControls).toBeGreaterThanOrEqual(20);
        await page.setViewportSize({ width: 390, height: 740 });
        expect(await layout(page)).toEqual(opening);
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const worldPosition = () => page.evaluate(() => {
        const world = window.__testWorld;
        const tile = world.badlands.children[2];
        const point = tile.position.clone();
        tile.getWorldPosition(point);
        return { distance: world.distance, position: point.toArray() };
      });
      const firstMountain = await worldPosition();
      await playUntil(page, 4.3);
      const nextMountain = await worldPosition();
      expect(nextMountain.position[2] - firstMountain.position[2]).toBeCloseTo(nextMountain.distance - firstMountain.distance, 8);
      expect(nextMountain.position[2]).toBeGreaterThan(firstMountain.position[2] + 40);
      await expect(page.locator("#game-tip")).toHaveCSS("opacity", "1");
      await expect(page.locator(".camera-drag-hint")).toHaveCSS("opacity", "1");
      await playUntil(page, 5.2);
      await expect(page.locator("body")).toHaveClass(/hints-dismissed/);
      for (const selector of ["#game-tip", ".camera-drag-hint"]) {
        await expect(page.locator(selector)).toHaveCSS("opacity", "0");
        await expect(page.locator(selector)).toHaveCSS("visibility", "hidden");
      }
      expect(await layout(page)).toEqual(opening);
      await page.locator("#view-toggle").click();
      expect(await page.evaluate(() => window.__saurian.state.view)).toBe("first");
      await page.locator("#pause-button").click();
      const pausedMountain = await worldPosition();
      await page.clock.runFor(1000);
      expect(await worldPosition()).toEqual(pausedMountain);
      await page.locator("#pause-home").click();
      await expect(page.locator(".camera-drag-hint")).toHaveCSS("opacity", "1");
      await page.locator("#start-button").click();
      await expect(page.locator("#game-tip")).toHaveCSS("opacity", "1");
      expect(errors).toEqual([]);
    });
  });
}

test("Safari-compatible icons are explicit game assets at the Pages subpath", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain('name="apple-mobile-web-app-title" content="SAURIAN"');
  expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="./saurian-apple-touch-icon.png"');
  const ico = await request.get("/saurian-favicon.ico");
  expect(ico.ok()).toBe(true);
  expect([...(await ico.body()).subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]);
  await page.goto("/saurian-icon.svg");
  for (const [name, size] of [["saurian-icon-32.png", 32], ["saurian-apple-touch-icon.png", 180]]) {
    const dimensions = await page.evaluate(async (path) => {
      const image = new Image();
      image.src = path;
      await image.decode();
      return [image.width, image.height];
    }, `/${name}`);
    expect(dimensions).toEqual([size, size]);
  }
});
