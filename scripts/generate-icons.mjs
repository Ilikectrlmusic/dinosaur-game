import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const root = new URL("../public/", import.meta.url);
const svg = await readFile(new URL("saurian-icon.svg", root), "utf8");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const icons = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await image.decode();
    return [16, 32, 48, 180].map((size) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const context = canvas.getContext("2d");
      if (size === 180) { context.fillStyle = "#e5814a"; context.fillRect(0, 0, size, size); }
      context.drawImage(image, 0, 0, size, size);
      return { size, png: canvas.toDataURL("image/png").split(",")[1], rgba: [...context.getImageData(0, 0, size, size).data] };
    });
  }, svg);
  await writeFile(new URL("saurian-icon-32.png", root), Buffer.from(icons[1].png, "base64"));
  await writeFile(new URL("saurian-apple-touch-icon.png", root), Buffer.from(icons[3].png, "base64"));

  // Classic 32-bit DIB entries also work in browsers that cannot read SVG/PNG
  // favicons. Include the alpha mask and all common tab icon sizes.
  const entries = icons.slice(0, 3).map(({ size, rgba }) => {
    const maskStride = Math.ceil(size / 32) * 4;
    const bitmap = Buffer.alloc(40 + size * size * 4 + maskStride * size);
    bitmap.writeUInt32LE(40, 0);
    bitmap.writeInt32LE(size, 4); bitmap.writeInt32LE(size * 2, 8);
    bitmap.writeUInt16LE(1, 12); bitmap.writeUInt16LE(32, 14);
    bitmap.writeUInt32LE(size * size * 4, 20);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const source = (y * size + x) * 4, dest = 40 + ((size - 1 - y) * size + x) * 4;
      bitmap[dest] = rgba[source + 2]; bitmap[dest + 1] = rgba[source + 1];
      bitmap[dest + 2] = rgba[source]; bitmap[dest + 3] = rgba[source + 3];
      if (!rgba[source + 3]) bitmap[40 + size * size * 4 + (size - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x % 8);
    }
    return { size, bitmap };
  });
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, bitmap }, i) => {
    const at = 6 + i * 16;
    header[at] = header[at + 1] = size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bitmap.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += bitmap.length;
  });
  await writeFile(new URL("saurian-favicon.ico", root), Buffer.concat([header, ...entries.map(({ bitmap }) => bitmap)]));
} finally {
  await browser.close();
}
