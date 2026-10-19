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
      "this.distance = 0;", "this.distance = 0; window.__testWorld = this; window.__testThree = THREE;",
    ) });
  });
  await page.addInitScript(() => localStorage.setItem(
    "saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: false, difficulty: "easy", best: { easy: 321, normal: 6543, hard: 98765 } }),
  ));
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await page.evaluate(() => document.fonts.ready);
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
      tipCenterOffset: tip.getBoundingClientRect().left + tip.getBoundingClientRect().width / 2 - innerWidth / 2,
      viewAnchor: innerWidth <= 700 ? view.getBoundingClientRect().top : innerHeight - view.getBoundingClientRect().bottom,
      viewLeft: view.getBoundingClientRect().left,
      hudGap: view.getBoundingClientRect().top - document.getElementById("game-hud").getBoundingClientRect().bottom,
      hintGap: hint.getBoundingClientRect().top - view.getBoundingClientRect().bottom,
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
    test("surfaces stay aligned with plants while opening hints fade and reset without shifting the view control", async ({ page }) => {
      test.setTimeout(90000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openControlledGame(page);
      await expect(page.locator("#camp-best")).toHaveText("321 M");
      await page.locator('[data-difficulty="normal"]').click();
      await expect(page.locator("#camp-best")).toHaveText("6543 M");
      await page.locator('[data-difficulty="hard"]').click();
      await expect(page.locator("#camp-best")).toHaveText("98765 M");
      await page.locator('[data-difficulty="easy"]').click();
      if (mobile) {
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 844 });
          const camp = await page.evaluate(() => {
            const view = document.getElementById("view-control").getBoundingClientRect();
            const footer = document.getElementById("footer").getBoundingClientRect();
            const hint = document.querySelector(".camera-drag-hint").getBoundingClientRect();
            const controls = document.querySelector(".controls-hint").getBoundingClientRect();
            return { borderGap: view.top - footer.top, edgeGap: innerHeight - hint.bottom, textGap: hint.left - controls.right };
          });
          expect(camp.borderGap).toBeGreaterThanOrEqual(4);
          expect(camp.edgeGap).toBeGreaterThanOrEqual(6);
          expect(camp.textGap).toBeGreaterThan(12);
        }
      } else {
        for (const [width, height] of [[1920, 1080], [1920, 900], [1600, 940], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [900, 800], [900, 650], [800, 600]]) {
          await page.setViewportSize({ width, height });
          const gap = await page.evaluate(() => document.getElementById("footer").getBoundingClientRect().top - document.querySelector(".camp-record").getBoundingClientRect().bottom);
          expect(gap, `camp record above footer at ${width}×${height}`).toBeGreaterThanOrEqual(16);
        }
        await page.setViewportSize({ width: 1280, height: 800 });
      }
      await expect(page.locator("#toast")).toHaveCSS("top", mobile ? "72px" : "32px");
      await page.locator("#start-button").click();
      await page.clock.runFor(100);
      await expect(page.locator("#best")).toHaveText("321 M");
      expect(await page.locator("#distance").innerText()).toMatch(/^(0|[1-9]\d*) M$/);
      const opening = await layout(page);
      expect(opening.tipBottom).toBe(mobile ? 104 : 39);
      expect(Math.abs(opening.tipCenterOffset)).toBeLessThan(0.5);
      expect(opening.viewAnchor).toBe(mobile ? 98 : 32);
      if (mobile) {
        expect(opening.viewLeft).toBe(18);
        expect(opening.hudGap).toBeGreaterThanOrEqual(12);
        expect(opening.hintGap).toBe(7);
        await page.setViewportSize({ width: 390, height: 740 });
        expect(await layout(page)).toEqual(opening);
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const worldPosition = () => page.evaluate(() => {
        const world = window.__testWorld;
        const tile = world.badlands.children[2];
        const point = tile.position.clone();
        tile.getWorldPosition(point);
        const { Raycaster, Vector3 } = window.__testThree;
        const sample = (width, x, z) => {
          const mesh = world.scene.children.find((object) => object.isMesh && object.geometry.parameters?.width === width);
          mesh.updateWorldMatrix(true, false);
          const ray = new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0));
          const hit = ray.intersectObject(mesh)[0];
          const mapUV = (map) => {
            const uv = hit.uv.clone();
            map.updateMatrix();
            return map.transformUv(uv).toArray();
          };
          return { color: mapUV(mesh.material.map), normal: mesh.material.normalMap ? mapUV(mesh.material.normalMap) : null, height: hit.point.y };
        };
        window.__testPlantIndex ??= world.plants.findIndex((plant) => plant.position.z < -80);
        const plant = world.plants[window.__testPlantIndex];
        return {
          distance: world.distance, position: point.toArray(), plantZ: plant.position.z,
          ground: sample(650, plant.position.x, plant.position.z),
          trail: sample(6, 0, -20 + world.distance),
          contactError: Math.max(...world.plants.map((plant) => Math.abs(plant.position.y - sample(650, plant.position.x, plant.position.z).height))),
        };
      });
      const firstMountain = await worldPosition();
      await playUntil(page, 4.3);
      const nextMountain = await worldPosition();
      expect(firstMountain.contactError).toBeLessThan(1e-6);
      expect(nextMountain.contactError).toBeLessThan(1e-6);
      expect(nextMountain.position[2] - firstMountain.position[2]).toBeCloseTo(nextMountain.distance - firstMountain.distance, 8);
      expect(nextMountain.position[2]).toBeGreaterThan(firstMountain.position[2] + 40);
      expect(nextMountain.plantZ - firstMountain.plantZ).toBeCloseTo(nextMountain.distance - firstMountain.distance, 6);
      // A point moving with a plant must stay on the same surface texel.
      // This checks the real plane UV orientation, not just the offset sign.
      for (const surface of ["ground", "trail"]) for (const channel of ["color", "normal"]) {
        const before = firstMountain[surface][channel], after = nextMountain[surface][channel];
        if (!before) continue;
        after.forEach((value, i) => {
          const difference = Math.abs(value - before[i]);
          expect(Math.min(difference, 1 - difference)).toBeLessThan(1e-5);
        });
      }
      await expect(page.locator("#game-tip")).toHaveCSS("opacity", "1");
      await expect(page.locator(".camera-drag-hint")).toHaveCSS("opacity", "1");
      await playUntil(page, 5.2);
      await expect(page.locator("body")).toHaveClass(/hints-dismissed/);
      // Commit a real compositor frame: the simulated RAF used for the long
      // gameplay run cannot itself start Chromium's native CSS transitions.
      await page.screenshot({ animations: "allow" });
      await page.clock.runFor(800);
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

test.describe("large mobile controls", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  test("corner areas respond outside the circles and release independent touches without blocking view switching", async ({ page }) => {
    await openControlledGame(page);
    await page.locator("#start-button").click();
    await page.clock.runFor(100);
    for (const id of ["touch-duck", "touch-jump"]) {
      const bounds = await page.locator(`#${id}`).boundingBox();
      expect(bounds.width).toBe(195);
      expect(bounds.height).toBe(200);
    }
    const duck = page.locator("#touch-duck");
    await duck.dispatchEvent("pointerdown", { pointerId: 900, button: 0, pointerType: "touch" });
    await page.mouse.move(155, 754);
    await page.mouse.down();
    await page.clock.runFor(300);
    expect(await page.evaluate(() => window.__saurian.state.duck)).toBeGreaterThan(0.9);
    await page.mouse.up();
    await page.clock.runFor(100);
    await expect(duck).toHaveClass(/is-held/);
    expect(await page.evaluate(() => window.__saurian.state.duck)).toBeGreaterThan(0.9);
    await duck.dispatchEvent("pointercancel", { pointerId: 900 });
    await page.clock.runFor(400);
    expect(await page.evaluate(() => window.__saurian.state.duck)).toBeLessThan(0.05);
    await expect(duck).not.toHaveClass(/is-held/);
    await page.mouse.click(225, 804);
    await page.clock.runFor(100);
    expect(await page.evaluate(() => window.__saurian.state.y)).toBeGreaterThan(0.5);
    await page.locator("#view-toggle").tap();
    expect(await page.evaluate(() => window.__saurian.state.view)).toBe("first");
    await page.locator("#pause-button").tap();
    await page.locator("#pause-home").tap();
    await expect(page.locator("#mobile-controls")).toBeHidden();
    await page.locator('[data-rider="1"]').tap();
    expect(await page.evaluate(() => window.__saurian.state.rider)).toBe(1);
  });
});

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
