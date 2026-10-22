import { test, expect } from "@playwright/test";

for (const late of [false, true]) {
  test(`first-visit ground appearance stays stable after ${late ? "late" : "ready"} texture downloads`, async ({ page }) => {
    await page.clock.install();
    let release;
    const downloads = new Promise((resolve) => { release = resolve; });
    let requests = 0;
    await page.route("**/ground-*.webp*", async (route) => {
      requests++;
      if (late) await downloads;
      await route.continue();
    });
    await page.route("**/src/main.js*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replaceAll(
        "renderer.render(world.scene, camera);", "if (!window.__skipGraphics) renderer.render(world.scene, camera);",
      ).replace("// A small read-only diagnostic surface", "window.__surfaceWorld = world; // A small read-only diagnostic surface") });
    });
    await page.addInitScript(() => localStorage.setItem("saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: false })));
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
      await page.evaluate(() => { window.__skipGraphics = true; });
      await expect.poll(() => requests).toBe(2);
      if (!late) await page.evaluate(() => window.__surfaceWorld.ready);
      await page.clock.fastForward(5000);
      await page.clock.runFor(1000);
      // WebKit can deliver the promise/RAF that hides the loader after the
      // clock jump completes; keep advancing until its fade timer finishes.
      await expect.poll(async () => {
        await page.clock.runFor(250);
        return page.locator("#loading").count();
      }).toBe(0);
      await page.locator("#start-button").click();
      await page.clock.runFor(2000);
      expect(await page.evaluate(() => window.__saurian.state.mode)).toBe("running");
      await page.locator("#pause-button").click();
      const surface = () => page.evaluate(() => {
        const world = window.__surfaceWorld, material = world.ground.material;
        return { color: material.map.uuid, normal: material.normalMap?.uuid ?? null,
          sand: world.sand.uuid, tint: material.color.getHexString(),
          shaderVersion: material.version, uv: material.map.offset.toArray() };
      });
      const before = await surface();
      if (late) expect(before.normal).toBeNull();
      else expect(before.normal).not.toBeNull();
      release();
      await page.evaluate(() => window.__surfaceWorld.ready);
      expect(await surface()).toEqual(before);
    } finally {
      release();
    }
  });
}

async function openControlledGame(page, preferences = {}) {
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
  await page.addInitScript((preferences) => {
    if (!localStorage.getItem("saurian-preferences")) localStorage.setItem(
      "saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: false, difficulty: "easy", best: { easy: 321, normal: 6543, hard: 98765 }, ...preferences }),
    );
  }, preferences);
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
      hudGap: view.querySelector("button").getBoundingClientRect().top - document.getElementById("game-hud").getBoundingClientRect().bottom,
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

test("survival guides show independent touch and keyboard instructions for the active layout", async ({ page }) => {
  await openControlledGame(page);
  await page.locator("#nav-guide").click();
  const guide = page.locator("#guide-dialog");
  for (const [width, height] of [[1280, 800], [390, 844], [320, 568], [701, 800], [700, 800]]) {
    await page.setViewportSize({ width, height });
    const mobile = width <= 700;
    const active = guide.locator(mobile ? ".guide-mobile" : ".guide-desktop");
    await expect(active).toBeVisible();
    await expect(guide.locator(mobile ? ".guide-desktop" : ".guide-mobile")).toBeHidden();
    await expect(active.locator(".guide-grid > div")).toHaveCount(4);
    await expect(active).toContainText("150 米");
    await expect(active).toContainText("300 米");
    if (mobile) {
      await expect(active).toContainText("右下角");
      await expect(active).toContainText("左下角");
      await expect(active).not.toContainText(/SPACE|ESC|键盘|鼠标/);
    } else {
      await expect(active).toContainText("SPACE");
      await expect(active).toContainText("鼠标");
      await expect(active).not.toContainText(/右下角|左下角|轻触/);
    }
    expect(await guide.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await guide.locator(".modal-close-action").click();
  await expect(guide).not.toBeVisible();
});

test("varied near rocks meet the terrain and keep the running lane clear", async ({ page }) => {
  await openControlledGame(page);
  const result = await page.evaluate(() => {
    const world = window.__testWorld, { Matrix4, Vector3 } = window.__testThree;
    const matrix = new Matrix4(), point = new Vector3(), bottom = new Vector3();
    let count = 0, largestGap = -Infinity, innerEdge = Infinity;
    for (const batch of world.rocks.children) for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, matrix);
      bottom.set(0, Infinity, 0);
      const positions = batch.geometry.attributes.position;
      for (let v = 0; v < positions.count; v++) {
        point.fromBufferAttribute(positions, v).applyMatrix4(matrix);
        if (point.y < bottom.y) bottom.copy(point);
        innerEdge = Math.min(innerEdge, Math.abs(point.x));
      }
      largestGap = Math.max(largestGap, bottom.y - world.groundHeightAt(bottom.x, bottom.z));
      count++;
    }
    return { count, kinds: new Set(world.rocks.children.map((batch) => batch.geometry.name)).size, largestGap, innerEdge };
  });
  expect(result.kinds).toBeGreaterThanOrEqual(5);
  expect(result.count).toBeGreaterThanOrEqual(200);
  expect(result.largestGap).toBeLessThan(0);
  expect(result.innerEdge).toBeGreaterThan(4.5);
});

test("new records animate during the crash, remain separate by difficulty and fit the whole desktop result", async ({ page }) => {
  test.setTimeout(120000);
  await openControlledGame(page, { best: { easy: 1, normal: 543, hard: 987 } });
  for (const [id, name, score] of [["hard", "极限", 987], ["normal", "冒险", 543], ["easy", "悠然", 1]]) {
    await page.locator(`[data-difficulty="${id}"]`).click();
    await expect(page.locator("#camp-best-difficulty")).toContainText(name);
    await expect(page.locator("#camp-best")).toHaveText(`${score} M`);
  }
  const reachMode = async (mode) => expect.poll(async () => {
    await page.clock.runFor(100);
    return page.evaluate(() => window.__saurian.state.mode);
  }, { timeout: 20000, intervals: [25, 50, 100] }).toBe(mode);
  await page.locator("#start-button").click();
  await reachMode("crashed");
  const record = await page.evaluate(() => window.__saurian.state.best.easy);
  expect(record).toBeGreaterThan(1);
  await expect(page.locator("#distance")).toHaveText(`${record} M`);
  await expect(page.locator("#best")).toHaveClass(/record-highlight/);
  expect(Number.parseInt(await page.locator("#best").innerText())).toBeLessThan(record);
  await reachMode("dead");
  await expect(page.locator("#best")).toHaveText(`${record} M`);
  await expect(page.locator("#final-best")).toHaveClass(/record-highlight/);
  await expect(page.locator("#new-best")).toBeVisible();
  await page.locator("#death-reason").evaluate((el) => { el.textContent = "没能一次越过三连仙人掌。留意整组的长度，让起跳和落地都避开荆棘。"; });
  for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [900, 650], [800, 600], [1024, 500], [900, 450]]) {
    await page.setViewportSize({ width, height });
    const size = await page.locator("#death-dialog").evaluate((el) => {
      const rect = el.getBoundingClientRect(), shortcut = document.querySelector(".death-shortcut").getBoundingClientRect();
      return { client: el.clientHeight, scroll: el.scrollHeight, top: rect.top, bottom: rect.bottom, shortcutBottom: shortcut.bottom };
    });
    expect(size.scroll, `${width}×${height}`).toBeLessThanOrEqual(size.client);
    expect(size.top).toBeGreaterThanOrEqual(16);
    expect(size.bottom).toBeLessThanOrEqual(height - 16);
    expect(size.shortcutBottom).toBeLessThan(size.bottom);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".death-shortcut")).toBeHidden();
  await page.locator("#retry-button").click();
  await expect(page.locator("#best")).not.toHaveClass(/record-highlight/);
  await expect(page.locator("#best")).toHaveText(`${record} M`);
  await page.locator("#pause-button").click();
  await page.locator("#pause-home").click();
  await page.locator('[data-difficulty="hard"]').click();
  await expect(page.locator("#camp-best")).toHaveText("987 M");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("saurian-preferences")).best)).toEqual({ easy: record, normal: 543, hard: 987 });
  await page.locator("#start-button").click();
  await reachMode("crashed");
  await expect(page.locator("#best")).not.toHaveClass(/record-highlight/);
  await reachMode("dead");
  await expect(page.locator("#new-best")).toBeHidden();
  await expect(page.locator("#final-best")).not.toHaveClass(/record-highlight/);
  await expect(page.locator("#final-best")).toHaveText("987 M");
});

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
            return { borderGap: view.top - footer.top, edgeGap: innerHeight - hint.bottom, textGap: view.left - hint.right };
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
      await expect(page.locator("#toast")).toHaveCSS("top", mobile ? "72px" : "120px");
      await page.locator("#start-button").click();
      await page.clock.runFor(100);
      await expect(page.locator("#best")).toHaveText("321 M");
      expect(await page.locator("#distance").innerText()).toMatch(/^(0|[1-9]\d*) M$/);
      const opening = await layout(page);
      expect(opening.tipBottom).toBe(mobile ? 112 : 39);
      expect(Math.abs(opening.tipCenterOffset)).toBeLessThan(0.5);
      expect(opening.viewAnchor).toBe(mobile ? 72 : 32);
      if (mobile) {
        expect(opening.viewLeft).toBe(18);
        expect(opening.hudGap).toBeGreaterThanOrEqual(8);
        expect(opening.viewAnchor).toBe(await page.locator("#toast").evaluate((element) => parseFloat(getComputedStyle(element).top)));
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
          rockZ: world.rocks.position.z,
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
      expect(nextMountain.rockZ - firstMountain.rockZ).toBeCloseTo(nextMountain.distance - firstMountain.distance, 6);
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
      if (mobile) {
        const gap = await page.evaluate(() => {
          const view = document.getElementById("view-control").getBoundingClientRect();
          const banner = document.getElementById("toast").getBoundingClientRect();
          return banner.left - view.right;
        });
        expect(gap).toBeGreaterThanOrEqual(6);
      }
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
    // WebKit may coalesce RAF callbacks after a clock jump. Wait for the
    // actual pose to settle while advancing hold recognition and game time.
    await expect.poll(async () => {
      await page.clock.runFor(100);
      return page.evaluate(() => window.__saurian.state.duck);
    }).toBeGreaterThan(0.9);
    await page.mouse.up();
    await page.clock.runFor(100);
    await expect(duck).toHaveClass(/is-held/);
    expect(await page.evaluate(() => window.__saurian.state.duck)).toBeGreaterThan(0.9);
    await duck.dispatchEvent("pointercancel", { pointerId: 900 });
    await expect.poll(async () => {
      await page.clock.runFor(100);
      return page.evaluate(() => window.__saurian.state.duck);
    }).toBeLessThan(0.05);
    await expect(duck).not.toHaveClass(/is-held/);
    await page.mouse.click(225, 804);
    await expect.poll(async () => {
      await page.clock.runFor(50);
      return page.evaluate(() => window.__saurian.state.y);
    }).toBeGreaterThan(0.5);
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
  expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="./saurian-touch-v2-180.png"');
  expect(html).toContain('rel="apple-touch-icon-precomposed"');
  expect(html).toContain('rel="manifest" href="./saurian.webmanifest"');
  expect(html).not.toContain('type="image/svg+xml"');
  const ico = await request.get("/saurian-icon-v2.ico");
  expect(ico.ok()).toBe(true);
  expect([...(await ico.body()).subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]);
  await page.goto("/saurian-icon.svg");
  const manifest = await (await request.get("/saurian.webmanifest")).json();
  expect(manifest.name).toContain("SAURIAN");
  expect(manifest.start_url).toBe("./");
  for (const [name, size] of [["saurian-icon-v2-32.png", 32], ["saurian-touch-v2-180.png", 180], ["saurian-icon-v2-192.png", 192], ["saurian-icon-v2-512.png", 512]]) {
    const dimensions = await page.evaluate(async (path) => {
      const image = new Image();
      image.src = path;
      await image.decode();
      return [image.width, image.height];
    }, `/${name}`);
    expect(dimensions).toEqual([size, size]);
  }
});
