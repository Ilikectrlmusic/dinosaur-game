import { test, expect } from "@playwright/test";

test("menu settings, running controls, cactus jump, collision physics and retry work", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      "saurian-preferences",
      JSON.stringify({ quality: "low", motion: false }),
    );
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 3);
  await expect(page.locator("#loading")).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
  await page.locator('[data-rider="2"]').click();
  await expect(page.locator('[data-rider="2"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('[data-difficulty="hard"]').click();
  expect(await page.evaluate(() => window.__saurian.state.difficulty)).toBe(
    "hard",
  );
  await page.locator("#nav-guide").click();
  await expect(page.locator("#guide-dialog")).toBeVisible();
  await page.locator("#guide-dialog .modal-close").click();
  await page.locator("#nav-settings").click();
  await page.locator("#audio-setting").uncheck({ force: true });
  await expect(page.locator("#sound-toggle")).toHaveAttribute(
    "aria-label",
    "开启音效",
  );
  await page.locator("#settings-dialog .modal-close-action").click();
  await page.locator('[data-difficulty="easy"]').click();
  await page.locator("#start-button").click();
  await page.waitForFunction(() => window.__saurian.state.distance > 1);
  expect(await page.evaluate(() => window.__saurian.state.rider)).toBe(2);
  await page.keyboard.press("v");
  expect(await page.evaluate(() => window.__saurian.state.view)).toBe("first");
  await page.keyboard.press("v");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("a");
  await page.keyboard.press("d");
  expect(await page.evaluate(() => window.__saurian.state.x)).toBe(0);
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(() => window.__saurian.state.duck > 0.9);
  await page.keyboard.up("ArrowDown");
  await page.locator("#pause-button").click();
  const paused = await page.evaluate(() => window.__saurian.state.distance);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__saurian.state.distance)).toBe(
    paused,
  );
  await page.locator("#resume-button").click();
  // Real-time obstacle timing verifies a jump against the actual collision routine.
  await page.waitForFunction(
    () => window.__saurian.state.obstacles.some((o) => o.z > -6 && o.z < -3.6),
    {},
    { timeout: 120000 },
  );
  expect(await page.evaluate(() => window.__saurian.state.obstacles.every(o => o.x === 0))).toBe(true);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__saurian.state.y > 1);
  await page.waitForFunction(
    () => window.__saurian.state.obstacles.some((o) => o.z > 2),
    {},
    { timeout: 30000 },
  );
  expect(await page.evaluate(() => window.__saurian.state.mode)).toBe(
    "running",
  );
  // Restart, remain grounded and allow the first obstacle to hit the rider.
  await page.keyboard.press("r");
  await page.waitForFunction(
    () =>
      window.__saurian.state.mode === "crashed" ||
      window.__saurian.state.mode === "dead",
    {},
    { timeout: 120000 },
  );
  expect(
    await page.evaluate(() => window.__saurian.state.physicsBodies),
  ).toBeGreaterThan(25);
  await expect(page.locator("#death-dialog")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#final-distance")).not.toHaveText("0 M");
  await page.locator("#retry-button").click();
  await page.waitForFunction(() => window.__saurian.state.mode === "running");
  expect(await page.evaluate(() => window.__saurian.state.physicsBodies)).toBe(
    0,
  );
  await page.locator("#pause-button").click();
  await page.locator("#pause-home").click();
  await expect(page.locator("#menu")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile layout and touch controls remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "saurian-preferences",
      JSON.stringify({ quality: "low" }),
    ),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await expect(page.locator("#loading")).toHaveCount(0);
  await expect(page.locator("#start-button")).toBeInViewport();
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: innerWidth,
  }));
  expect(size.scroll).toBe(size.width);
  await page.locator("#start-button").click();
  await expect(page.locator("#touch-jump")).toBeVisible();
  await expect(page.locator("#mobile-controls button")).toHaveCount(2);
  await expect(page.locator("#touch-left, #touch-right")).toHaveCount(0);
  await page.locator("#touch-jump").dispatchEvent("pointerdown", {pointerId:1, button:0});
  await page.waitForFunction(() => window.__saurian.state.y > 0);
  await page.locator("#touch-jump").dispatchEvent("pointerup", {pointerId:1, button:0});
  expect(await page.evaluate(() => window.__saurian.state.x)).toBe(0);
});

test("ragdoll settles under gravity, rotates and throws the rider without invalid positions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "saurian-preferences",
      JSON.stringify({ quality: "low" }),
    ),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian);
  const result = await page.evaluate(async () => {
    const { buildDinosaur, buildCactus } = await import("/src/creatures.js");
    const { CrashPhysics } = await import("/src/physics.js");
    const dino = buildDinosaur(0),
      scene = new dino.root.constructor();
    scene.add(dino.root);
    const cactus = buildCactus(1.6);
    cactus.position.z = -1.2;
    cactus.userData = { type: "cactus", height: 1.6 };
    scene.add(cactus);
    const physics = new CrashPhysics(scene, dino, 11, cactus);
    for (let i = 0; i < 360; i++) physics.update(1 / 120);
    const result = {
      mountY: physics.centerBody.position.y,
      riderY: physics.riderBody.position.y,
      riderZ: physics.riderBody.position.z,
      rotation: Math.abs(physics.centerBody.quaternion.z),
      finite: physics.world.bodies.every((b) =>
        [b.position.x, b.position.y, b.position.z].every(Number.isFinite),
      ),
    };
    physics.dispose();
    return result;
  });
  expect(result.finite).toBe(true);
  expect(result.mountY).toBeLessThan(1.3);
  expect(result.mountY).toBeGreaterThan(0);
  expect(result.riderY).toBeLessThan(1);
  expect(result.riderY).toBeGreaterThan(0);
  expect(result.riderZ).toBeLessThan(-2);
  expect(result.rotation).toBeGreaterThan(0.5);
});
