import { test, expect } from "@playwright/test";

async function openGame(page, extra = {}) {
  await page.addInitScript((settings) => {
    localStorage.setItem(
      "saurian-preferences",
      JSON.stringify({ quality: "low", motion: false, ...settings }),
    );
  }, extra);
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await expect(page.locator("#loading")).toHaveCount(0);
}

async function drag(page, from, to) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 5 });
  await page.mouse.up();
}

test("mouse dragging orbits the mount, turns the first person view and releases capture for dialogs", async ({
  page,
}) => {
  await openGame(page);
  const before = await page.evaluate(
    () => window.__saurian.state.camera.position,
  );
  await drag(page, [610, 370], [720, 415]);
  await page.waitForFunction(
    (start) =>
      Math.hypot(
        ...window.__saurian.state.camera.position.map((v, i) => v - start[i]),
      ) > 1,
    before,
  );
  await expect(page.locator("#scene canvas")).not.toHaveClass(/is-dragging/);
  await page.mouse.dblclick(620, 370);
  await page.waitForFunction(
    (start) =>
      Math.hypot(
        ...window.__saurian.state.camera.position.map((v, i) => v - start[i]),
      ) < 0.2,
    before,
  );
  await page.locator("#start-button").click();
  await page.keyboard.press("v");
  await page.waitForFunction(
    () =>
      Math.abs(window.__saurian.state.camera.target[0]) < 0.1 &&
      window.__saurian.state.camera.position[2] < 0,
  );
  await drag(page, [560, 345], [680, 385]);
  await page.waitForFunction(
    () => Math.abs(window.__saurian.state.camera.target[0]) > 4,
  );
  // Pause while a drag is active: the canvas must relinquish the pointer.
  await page.mouse.move(600, 350);
  await page.mouse.down();
  await expect(page.locator("#scene canvas")).toHaveClass(/is-dragging/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-dialog")).toBeVisible();
  await expect(page.locator("#scene canvas")).not.toHaveClass(/is-dragging/);
  await page.mouse.up();
  await page.locator("#resume-button").click();
  await page.waitForFunction(() => window.__saurian.state.mode === "running");
});

test("death modal stops rendering and both retry and camp buttons remain clickable after a captured drag", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openGame(page, { difficulty: "hard" });
  await page.locator("#fullscreen-toggle").click();
  await page.locator("#start-button").click();
  await page.mouse.move(610, 340);
  await page.mouse.down();
  await page.waitForFunction(
    () => window.__saurian.state.mode === "dead",
    {},
    { timeout: 60000 },
  );
  await expect(page.locator("#death-dialog")).toBeVisible();
  await expect(page.locator("#scene canvas")).not.toHaveClass(/is-dragging/);
  const frame = await page.evaluate(
    () => window.__saurian.renderer.render.frame,
  );
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => window.__saurian.renderer.render.frame),
  ).toBe(frame);
  await page.mouse.up();
  await page.locator("#retry-button").click();
  await page.waitForFunction(() => window.__saurian.state.mode === "running");
  expect(await page.evaluate(() => window.__saurian.state.physicsBodies)).toBe(
    0,
  );
  await page.waitForFunction(
    () => window.__saurian.state.mode === "dead",
    {},
    { timeout: 60000 },
  );
  await expect(page.locator("#death-home")).toHaveCSS(
    "border-top-style",
    "solid",
  );
  await page.locator("#death-home").click();
  await page.waitForFunction(() => window.__saurian.state.mode === "menu");
  await page.locator('[data-rider="1"]').click();
  await page.locator("#start-button").click();
  await page.waitForFunction(() => window.__saurian.state.mode === "running");
  expect(await page.evaluate(() => window.__saurian.state.rider)).toBe(1);
  expect(errors).toEqual([]);
});

test("all riders bend at the hips without leaving the saddle or moving their legs", async ({
  page,
}) => {
  await openGame(page);
  const riders = await page.evaluate(async () => {
    const { buildDinosaur, animateDinosaur } = await import(
      "/src/creatures.js"
    );
    return [0, 1, 2].map((index) => {
      const dino = buildDinosaur(index),
        poses = [];
      for (const duck of [0, 0.25, 0.5, 0.75, 1, 0]) {
        animateDinosaur(dino, 1.2, 1, duck);
        dino.root.updateMatrixWorld(true);
        const rider = dino.rider;
        const seat = dino.saddle.worldToLocal(
          rider.pelvis.getWorldPosition(rider.pelvis.position.clone()),
        );
        poses.push({
          seat: seat.toArray(),
          headY: rider.head.getWorldPosition(rider.head.position.clone()).y,
          handsY: rider.limbs.map(
            ({ arm, side }) =>
              arm.localToWorld(
                arm.position.clone().set(side * 0.05, -0.48, -0.44),
              ).y,
          ),
          legs: rider.limbs.map(({ leg }) =>
            rider.pelvis
              .worldToLocal(leg.getWorldPosition(leg.position.clone()))
              .toArray(),
          ),
        });
      }
      return poses;
    });
  });
  for (const poses of riders) {
    for (const pose of poses) {
      for (let i = 0; i < 3; i++)
        expect(pose.seat[i]).toBeCloseTo(poses[0].seat[i], 8);
      expect(pose.legs).toEqual(poses[0].legs);
    }
    expect(poses[4].headY).toBeLessThan(poses[0].headY - 1.2);
    for (const handY of poses[4].handsY)
      expect(handY).toBeLessThan(poses[4].headY - 0.15);
    expect(poses[5].headY).toBeCloseTo(poses[0].headY, 8);
  }
});
