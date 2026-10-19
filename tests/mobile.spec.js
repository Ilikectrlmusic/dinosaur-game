import { test, expect } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});

async function openGame(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "saurian-preferences",
      JSON.stringify({ quality: "low", motion: false, difficulty: "hard" }),
    );
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await expect(page.locator("#loading")).toHaveCount(0);
}

async function waitForDeath(page) {
  await page.waitForFunction(() => window.__saurian.state.mode === "dead", {}, {
    timeout: 90000,
  });
  await expect(page.locator("#death-dialog")).toBeVisible();
  for (const id of ["retry-button", "death-home"]) {
    expect(await page.locator(`#${id}`).evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(
        rect.x + rect.width / 2, rect.y + rect.height / 2,
      ));
    })).toBe(true);
  }
  await expect(page.locator(".is-held, canvas.is-dragging")).toHaveCount(0);
}

test("mobile orbit keeps the rider centered; the single track has only jump and hold-to-duck controls", async ({ page }) => {
  await openGame(page);
  await expect(page.locator("#mobile-controls button")).toHaveCount(2);
  await expect(page.locator("#touch-left, #touch-right")).toHaveCount(0);
  await page.locator('[data-difficulty="easy"]').tap();
  await page.locator("#start-button").tap();
  await page.waitForFunction(() => window.__saurian.state.distance > 1);
  // Real pointer capture in the mobile viewport exercises orbit and cancellation.
  for (const [from, to] of [
    [[110, 360], [270, 360]],
    [[190, 440], [190, 300]],
    [[270, 360], [100, 390]],
  ]) {
    const before = await page.evaluate(() => window.__saurian.state.camera.position);
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction((previous) => Math.hypot(...window.__saurian.state.camera.position.map((v, i) => v - previous[i])) > 0.2, before);
    await page.waitForFunction(() => Math.abs(window.__saurian.state.riderScreen[0]) < 0.08);
  }
  for (const key of ["a", "d", "ArrowLeft", "ArrowRight"]) await page.keyboard.press(key);
  expect(await page.evaluate(() => window.__saurian.state.x)).toBe(0);

  const duck = page.locator("#touch-duck");
  await duck.evaluate((element) => element.addEventListener("pointerdown", (event) => {
    element.dataset.testPointer = event.pointerId;
  }, { once: true }));
  const rect = await duck.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => window.__saurian.state.duck > 0.9);
  await page.waitForTimeout(800);
  await expect(duck).toHaveClass(/is-held/);
  expect(await duck.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.userSelect || style.webkitUserSelect;
  })).toBe("none");
  expect(await duck.evaluate((element) => {
    const cancelled = !element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return { cancelled, selection: getSelection().toString() };
  })).toEqual({ cancelled: true, selection: "" });
  if (await page.evaluate(() => CSS.supports("-webkit-touch-callout", "none"))) {
    await expect(duck).toHaveCSS("-webkit-touch-callout", "none");
  }
  await duck.dispatchEvent("pointercancel", { pointerId: Number(await duck.getAttribute("data-test-pointer")) });
  await page.waitForFunction(() => window.__saurian.state.duck < 0.05);
  await expect(duck).not.toHaveClass(/is-held/);
  await page.mouse.up();
  const layout = await page.evaluate(() => {
    const tip = document.getElementById("game-tip").getBoundingClientRect();
    const view = document.getElementById("view-control").getBoundingClientRect();
    const controls = document.getElementById("mobile-controls").getBoundingClientRect();
    const hint = document.querySelector(".camera-drag-hint").getBoundingClientRect();
    return { tipBottom: tip.bottom, viewTop: view.top, viewBottom: view.bottom, hintBottom: hint.bottom, controlsTop: controls.top };
  });
  expect(layout.tipBottom).toBeLessThan(layout.viewTop);
  expect(layout.viewBottom).toBeLessThan(layout.controlsTop);
  expect(layout.controlsTop - layout.hintBottom).toBeGreaterThanOrEqual(20);
  await page.locator("#touch-jump").tap();
  await page.waitForFunction(() => window.__saurian.state.y > 0.1);
  await page.waitForFunction(() => window.__saurian.state.obstacles.length > 0);
  expect(await page.evaluate(() => window.__saurian.state.obstacles.every((o) => o.x === 0))).toBe(true);
});

test("mobile death actions survive held camera/control pointers, retry, backgrounding and returning to camp", async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openGame(page);
  await page.locator("#start-button").tap();
  await page.mouse.move(220, 380);
  await page.mouse.down();
  await page.mouse.move(300, 410, { steps: 4 });
  await waitForDeath(page);
  expect(await page.evaluate(() => window.__saurian.state.physicsBodies)).toBeGreaterThan(25);
  expect(await page.evaluate(() => window.__saurian.state.crashIssue)).toBeNull();
  await page.mouse.up();
  await page.locator("#retry-button").tap();
  await page.waitForFunction(() => window.__saurian.state.mode === "running");
  expect(await page.evaluate(() => window.__saurian.state.physicsBodies)).toBe(0);

  const rect = await page.locator("#touch-duck").boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => window.__saurian.state.mode === "crashed", {}, { timeout: 90000 });
  // Safari may suspend animation/timers when switching apps during a crash.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitForDeath(page);
  await page.mouse.up();
  await page.locator("#death-home").tap();
  await page.waitForFunction(() => window.__saurian.state.mode === "menu");
  await page.locator('[data-rider="1"]').tap();
  await page.locator("#start-button").tap();
  await page.waitForFunction(() => window.__saurian.state.mode === "running");
  expect(await page.evaluate(() => window.__saurian.state.rider)).toBe(1);
  await page.locator("#pause-button").tap();
  await page.locator("#resume-button").tap();
  await page.locator("#pause-button").tap();
  await page.locator("#pause-home").tap();
  await expect(page.locator("#menu")).toBeVisible();
  expect(errors).toEqual([]);
});

test("unavailable audio and interrupted crash physics never block either result action", async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.AudioContext = window.webkitAudioContext = class {
      constructor() { throw new Error("Simulated unavailable Safari audio"); }
    };
  });
  await openGame(page);
  await page.evaluate(async () => {
    const loadedModule = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/physics.js");
    const { CrashPhysics } = await import(loadedModule?.name || "/src/physics.js");
    const original = CrashPhysics.prototype.part;
    let count = 0;
    CrashPhysics.prototype.part = function (...args) {
      if (++count === 3) {
        CrashPhysics.prototype.part = original;
        throw new Error("Simulated partial crash initialization");
      }
      return original.apply(this, args);
    };
  });
  await page.locator("#start-button").tap();
  await waitForDeath(page);
  expect(await page.evaluate(() => window.__saurian.state.crashIssue)).toBe("Simulated partial crash initialization");
  await page.locator("#retry-button").tap();
  await page.waitForFunction(() => window.__saurian.state.mode === "running");
  await page.evaluate(async () => {
    const loadedModule = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/physics.js");
    const { CrashPhysics } = await import(loadedModule?.name || "/src/physics.js");
    const original = CrashPhysics.prototype.update;
    CrashPhysics.prototype.update = function () {
      CrashPhysics.prototype.update = original;
      throw new Error("Simulated interrupted crash animation");
    };
  });
  await waitForDeath(page);
  expect(await page.evaluate(() => window.__saurian.state.crashIssue)).toBe("Simulated interrupted crash animation");
  await page.locator("#death-home").tap();
  await page.waitForFunction(() => window.__saurian.state.mode === "menu");
  await page.locator('[data-rider="2"]').tap();
  await page.locator("#start-button").tap();
  expect(await page.evaluate(() => window.__saurian.state.mode)).toBe("running");
  expect(await page.evaluate(() => window.__saurian.state.physicsBodies)).toBe(0);
  expect(errors).toEqual([]);
});
