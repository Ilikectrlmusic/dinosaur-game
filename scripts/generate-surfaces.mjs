import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../src/assets/", import.meta.url));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage();
  await page.route("**/src/main.js*", (route) => route.fulfill({ contentType: "text/javascript", body: "export {};" }));
  await page.goto(process.env.SAURIAN_DEV_URL || "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  const images = await page.evaluate(async () => {
    const source = await import("/src/procedural-surfaces.js");
    const reptile = source.reptileSurface(), fabric = source.fabricSurface(), leather = source.leatherSurface();
    const surfaces = {
      "reptile-color": reptile.map.image,
      "reptile-normal": reptile.normalMap.image,
      fabric: fabric.map.image,
      leather: leather.map.image,
    };
    return Object.fromEntries(Object.entries(surfaces).map(([name, canvas]) => [name, canvas.toDataURL("image/webp", name.endsWith("normal") ? 0.92 : 0.88).split(",")[1]]));
  });
  for (const [name, base64] of Object.entries(images)) {
    const bytes = Buffer.from(base64, "base64");
    writeFileSync(resolve(output, `${name}.webp`), bytes);
    console.log(`${name}.webp: ${bytes.length} bytes`);
  }
} finally {
  await browser.close();
}
