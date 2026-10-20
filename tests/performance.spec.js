import { test, expect } from "@playwright/test";

async function openGame(page) {
  await page.route("**/src/main.js*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll(
      "renderer.render(world.scene, camera);",
      "if (!window.__skipGraphics) renderer.render(world.scene, camera);",
    ).replace("// A small read-only diagnostic surface",
      "window.__renderReview = { renderer, world }; // A small read-only diagnostic surface") });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem("saurian-preferences"))
      localStorage.setItem("saurian-preferences", JSON.stringify({
        quality: "low", motion: false, sound: false, rider: 2, mount: "dilophosaurus",
      }));
    window.__powerRequests = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      if (type === "webgl2" && options?.powerPreference)
        window.__powerRequests.push(options.powerPreference);
      return getContext.apply(this, arguments);
    };
  });
  await page.goto("/");
  await ready(page);
}

async function ready(page) {
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await page.evaluate(() => { window.__skipGraphics = true; });
  await expect(page.locator("#loading")).toHaveCount(0);
}

test("desktop saves each GPU preference, applies it on reload and preserves other settings", async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openGame(page);
  expect(await page.evaluate(() => window.__powerRequests[0])).toBe("default");
  const original = page.locator("#original-game");
  await expect(original).toHaveCSS("text-decoration-line", "underline");
  expect(await original.evaluate((element) => getComputedStyle(element).color)).toBe(
    await page.locator("#nav-guide").evaluate((element) => getComputedStyle(element).color),
  );
  await page.locator("#nav-settings").click();
  await expect(page.locator("#performance-setting")).toBeVisible();
  await expect(page.locator("#performance-setting option")).toHaveText(["自动", "高性能", "低性能"]);
  // Reverting an unsaved change should restore the normal close action.
  await page.locator("#performance-setting").selectOption("high-performance");
  await expect(page.locator("#settings-save")).toContainText("保存并重新加载");
  await page.locator("#performance-setting").selectOption("default");
  await expect(page.locator("#settings-save")).toContainText("保存并返回");
  for (const preference of ["high-performance", "low-power", "default"]) {
    const before = await page.evaluate(() => window.__powerRequests[0]);
    await page.locator("#performance-setting").selectOption(preference);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("saurian-preferences")).powerPreference)).toBe(preference);
    expect(await page.evaluate(() => window.__powerRequests[0])).toBe(before);
    await expect(page.locator("#performance-description")).toContainText("重新加载后生效");
    await Promise.all([
      page.waitForEvent("domcontentloaded"),
      page.locator("#settings-save").click(),
    ]);
    await ready(page);
    expect(await page.evaluate(() => window.__powerRequests[0])).toBe(preference);
    expect(await page.evaluate(() => window.__saurian.state)).toMatchObject({ rider: 2, mount: "dilophosaurus", sound: false });
    await page.locator("#nav-settings").click();
    await expect(page.locator("#performance-setting")).toHaveValue(preference);
    await expect(page.locator("#quality-setting")).toHaveValue("low");
    await expect(page.locator("#settings-save")).toContainText("保存并返回");
  }
  await page.locator("#settings-save").click();
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.__saurian.state.mode)).toBe("running");
  expect(errors).toEqual([]);
});

test.describe("phone preferences", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("desktop GPU controls stay hidden and saving other settings needs no reload", async ({ page }) => {
    await openGame(page);
    expect(await page.evaluate(() => window.__powerRequests[0])).toBe("high-performance");
    await page.locator("#nav-settings").tap();
    await expect(page.locator("#performance-setting")).toBeHidden();
    await expect(page.locator("#settings-save")).toContainText("保存并返回");
    await page.evaluate(() => { window.__settingsCheck = true; });
    await page.locator("#settings-save").tap();
    await expect(page.locator("#settings-dialog")).not.toBeVisible();
    expect(await page.evaluate(() => window.__settingsCheck)).toBe(true);
  });
});

test.describe("adaptive rendering", () => {
  test.use({ deviceScaleFactor: 2 });
  test("slow frames reduce only 3D resolution and shadows, while HUD nodes, controls and quality preference remain intact", async ({ page }) => {
    await openGame(page);
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator("#nav-settings").click();
    await page.locator("#quality-setting").selectOption("high");
    await page.locator("#settings-save").click();
    const before = await page.locator("#scene canvas").evaluate((canvas) => ({ pixels: canvas.width, css: canvas.getBoundingClientRect().width }));
    for (let i = 0; i < 85; i++) await page.clock.fastForward(100);
    const after = await page.evaluate(() => {
      const canvas = document.querySelector("#scene canvas");
      return { pixels: canvas.width, css: canvas.getBoundingClientRect().width,
        shadow: window.__renderReview.world.sun.shadow.mapSize.x,
        quality: JSON.parse(localStorage.getItem("saurian-preferences")).quality };
    });
    expect(after.pixels).toBeLessThan(before.pixels * 0.8);
    expect(after.css).toBe(before.css);
    expect(after.shadow).toBe(1024);
    expect(after.quality).toBe("high");
    await page.evaluate(() => { window.__distanceNode = document.querySelector("#distance").firstChild; });
    await page.locator("#start-button").click();
    await page.clock.runFor(500);
    expect(await page.evaluate(() => window.__distanceNode === document.querySelector("#distance").firstChild)).toBe(true);
    await page.locator("#pause-button").click();
    const ratio = await page.evaluate(() => window.__saurian.state.renderBudget.pixelRatio);
    await page.clock.fastForward(3000);
    expect(await page.evaluate(() => window.__saurian.state.renderBudget.pixelRatio)).toBe(ratio);
    await page.locator("#pause-home").click();
    await page.setViewportSize({ width: 1024, height: 768 });
    // WebKit queues viewport resize asynchronously even with a frozen clock.
    await expect.poll(async () => {
      await page.clock.runFor(50);
      return page.locator("#scene canvas").evaluate((canvas) => ({ pixels: canvas.width, css: canvas.getBoundingClientRect().width }));
    }).toEqual({ pixels: Math.floor(1024 * 1.65), css: 1024 });
  });
});
