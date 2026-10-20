import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

async function openGame(page, clock = true) {
  if (clock) await page.clock.install();
  await page.route("**/src/main.js*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replaceAll("renderer.render(world.scene, camera);", "if (!window.__skipGraphics) renderer.render(world.scene, camera);")
      .replace("// A small read-only diagnostic surface", "window.__testAudio = audio; // A small read-only diagnostic surface") });
  });
  await page.addInitScript(() => localStorage.setItem("saurian-preferences", JSON.stringify({ quality: "low", motion: false, sound: true })));
  await page.goto("/");
  await page.waitForFunction(() => window.__saurian?.renderer.render.frame > 2);
  await page.evaluate(() => { window.__skipGraphics = true; });
  if (clock) {
    await page.clock.fastForward(1500);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10000));
  }
  await expect(page.locator("#loading")).toHaveCount(0);
}

test("a visible gap above every cactus remains safe through the animated jump pose", async ({ page }) => {
  await openGame(page);
  const cases = await page.evaluate(async () => {
    const { buildDinosaur, animateDinosaur, cactusContactBounds } = await import("/src/creatures.js");
    const { overlapsRunner, CACTUS_HEIGHTS, JUMP_VELOCITY, GRAVITY } = await import("/src/rules.js");
    const { DinosaurGait } = await import("/src/dinosaur-gait.js");
    const dino = buildDinosaur();
    const cases = [];
    for (const height of Object.values(CACTUS_HEIGHTS)) for (const time of [0, .1, .25, .5, .75, .9, 1.05]) {
      // Advance through the actual takeoff, tuck, reach and recovery rather
      // than assuming a single height immediately selects a fixed flight pose.
      dino.gait = new DinosaurGait();
      dino.root.position.y = 0;
      animateDinosaur(dino, 0, 1, 0, 0, 1 / 120, 0, 0);
      for (let frame = 1; frame <= Math.round(time * 120); frame++) {
        const age = frame / 120;
        const y = Math.max(0, JUMP_VELOCITY * age - GRAVITY * age * age / 2);
        const velocity = y > 0 ? JUMP_VELOCITY - GRAVITY * age : 0;
        dino.root.position.y = y;
        animateDinosaur(dino, age, 1, 0, y, 1 / 120, 0, velocity);
      }
      const bottom = Math.min(...cactusContactBounds(dino).map((box) => box.min.y));
      dino.root.position.y += height + .01 - bottom;
      let bounds = cactusContactBounds(dino);
      const runner = { x: 0, y: dino.root.position.y, duck: 0, cactusBounds: bounds };
      const obstacle = { type: "cactus", x: 0, height };
      const clear = [-1, -.5, 0, .5, 1].every((z) => !overlapsRunner(runner, { ...obstacle, z }));
      const legacyWouldCollide = runner.y + .15 < height;
      dino.root.position.y -= .7;
      bounds = cactusContactBounds(dino);
      const touches = [-.5, 0, .3, .6].some((z) => overlapsRunner({ ...runner, cactusBounds: bounds }, { ...obstacle, z }));
      cases.push({ height, time, clear, legacyWouldCollide, touches });
    }
    return cases;
  });
  expect(cases).toHaveLength(21);
  for (const result of cases) expect(result, JSON.stringify(cases)).toMatchObject({ clear: true, touches: true });
  for (const height of [1.05, 1.55, 2.05])
    expect(cases.some((result) => result.height === height && result.legacyWouldCollide)).toBe(true);
});

test("bottom-region swipes orbit without jumping or ducking, while taps and stationary holds still work", async ({ page }) => {
  await openGame(page);
  await page.locator("#start-button").tap();
  await page.clock.runFor(150);
  let pointerId = 20;
  for (const [id, x, delta] of [["touch-jump", 245, -60], ["touch-duck", 145, 60]]) {
    const button = page.locator(`#${id}`);
    const before = await page.evaluate(() => window.__saurian.state.camera.rotation);
    const event = { pointerId: pointerId++, pointerType: "touch", button: 0, buttons: 1, clientX: x, clientY: 710 };
    await button.dispatchEvent("pointerdown", event);
    await button.dispatchEvent("pointermove", { ...event, clientX: x + delta, clientY: 680 });
    await page.clock.runFor(200);
    const state = await page.evaluate(() => window.__saurian.state);
    expect(state.y).toBe(0);
    expect(state.duck).toBe(0);
    expect(state.camera.rotation).not.toEqual(before);
    await button.dispatchEvent("pointerup", { ...event, buttons: 0, clientX: x + delta, clientY: 680 });
  }
  await page.touchscreen.tap(225, 804);
  await page.clock.runFor(100);
  expect(await page.evaluate(() => window.__saurian.state.y)).toBeGreaterThan(.5);
  await page.clock.runFor(1000);
  const duck = page.locator("#touch-duck");
  await duck.dispatchEvent("pointerdown", { pointerId: 40, pointerType: "touch", button: 0, buttons: 1, clientX: 150, clientY: 750 });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.__saurian.state.duck)).toBeGreaterThan(.95);
  await duck.dispatchEvent("pointercancel", { pointerId: 40 });
  await page.clock.runFor(300);
  expect(await page.evaluate(() => window.__saurian.state.duck)).toBeLessThan(.05);
  // Two quick camera swipes must not be treated as a native double click.
  const canvas = page.locator("canvas");
  for (const id of [50, 51]) {
    const event = { pointerId: id, pointerType: "touch", button: 0, buttons: 1, clientX: 150, clientY: 350 };
    await canvas.dispatchEvent("pointerdown", event);
    await canvas.dispatchEvent("pointermove", { ...event, clientX: 240 });
    await canvas.dispatchEvent("pointerup", { ...event, clientX: 240, buttons: 0 });
  }
  await canvas.dispatchEvent("dblclick", { clientX: 240, clientY: 350 });
  await expect(page.locator("#toast")).not.toHaveText("视角已回正");
});

test("completed gestures start audible Web Audio, resume suspension, and preserve the mute preference", async ({ page }) => {
  await openGame(page, false);
  await page.locator("#start-button").tap();
  await page.waitForFunction(() => window.__testAudio.context?.state === "running");
  await page.evaluate(() => {
    const audio = window.__testAudio;
    window.__analyser = audio.context.createAnalyser();
    audio.master.connect(window.__analyser);
    audio.roar(.4);
  });
  await page.waitForFunction(() => {
    const data = new Float32Array(window.__analyser.fftSize);
    window.__analyser.getFloatTimeDomainData(data);
    return data.some((sample) => Math.abs(sample) > .001);
  });
  await page.locator("#pause-button").tap();
  await page.evaluate(() => window.__testAudio.context.suspend());
  expect(await page.evaluate(() => window.__testAudio.context.state)).toBe("suspended");
  await page.locator("#resume-button").tap();
  await page.waitForFunction(() => window.__testAudio.context.state === "running");
  await page.locator("#pause-button").tap();
  await page.locator("#pause-home").tap();
  await page.locator("#sound-toggle").tap();
  await page.waitForFunction(() => window.__testAudio.master.gain.value < .001);
  await expect(page.locator("#sound-toggle")).toHaveAccessibleName("开启音效");
});

test("the original runner opens in a separate tab from camp", async ({ page }) => {
  await openGame(page);
  await page.context().route("https://litetex.github.io/t-rex-runner", (route) => route.fulfill({ contentType: "text/html", body: "<title>Original runner</title>" }));
  const link = page.getByRole("link", { name: "试玩原版" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const popup = page.waitForEvent("popup");
  await link.tap();
  const original = await popup;
  await expect(original).toHaveURL("https://litetex.github.io/t-rex-runner");
  await expect(original).toHaveTitle("Original runner");
  expect(await page.evaluate(() => window.__saurian.state.mode)).toBe("menu");
  await original.close();
});
