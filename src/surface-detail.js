import * as THREE from "three";

// These first-party surfaces are generated in advance to avoid a slow Canvas
// readback on Safari at startup. The generator is procedural-surfaces.js.
const pending = [];
function load(url, color = false, repeat = 1, normal = false) {
  let resolve;
  const ready = new Promise((done) => { resolve = done; });
  pending.push(ready);
  const map = new THREE.TextureLoader().load(url, resolve, undefined, () => {
    const fallback = document.createElement("canvas");
    fallback.width = fallback.height = 2;
    const context = fallback.getContext("2d");
    context.fillStyle = normal ? "#8080ff" : "#dddddd";
    context.fillRect(0, 0, 2, 2);
    map.image = fallback;
    map.needsUpdate = true;
    resolve();
  });
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.anisotropy = 4;
  return map;
}
const reptileColor = load(new URL("./assets/reptile-color.webp", import.meta.url).href, true, 2);
const reptileNormal = load(new URL("./assets/reptile-normal.webp", import.meta.url).href, false, 2, true);
const fabricColor = load(new URL("./assets/fabric.webp", import.meta.url).href, true);
const fabricBump = load(new URL("./assets/fabric.webp", import.meta.url).href);
const leatherColor = load(new URL("./assets/leather.webp", import.meta.url).href, true);
const leatherBump = load(new URL("./assets/leather.webp", import.meta.url).href);
export const surfaceReady = Promise.all(pending);

export function reptileSurface() {
  return { map: reptileColor, normalMap: reptileNormal, roughness: 0.78 };
}
export function fabricSurface() {
  return { map: fabricColor, bumpMap: fabricBump, bumpScale: 0.008, roughness: 0.94 };
}
export function leatherSurface() {
  return { map: leatherColor, bumpMap: leatherBump, bumpScale: 0.012, roughness: 0.78 };
}
export function contactShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d"), gradient = context.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, "#15160fd9"); gradient.addColorStop(0.4, "#17170e6b"); gradient.addColorStop(1, "#181a1200");
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
