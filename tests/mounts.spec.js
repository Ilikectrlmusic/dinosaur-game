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
        headSize: headBounds.getSize(new Vector3()).toArray(),
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
  expect(carno.headSize[0]).toBeGreaterThan(allo.headSize[0] * 1.5);
  expect(dilo.headSize[1]).toBeGreaterThan(allo.headSize[1] * 1.15);
  expect(dilo.headSize[2]).toBeGreaterThan(allo.headSize[2] * 1.1);
});
