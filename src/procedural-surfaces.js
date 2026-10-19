import * as THREE from "three";

function canvas(size) {
  const element = document.createElement("canvas");
  element.width = element.height = size;
  return element;
}
function texture(element, color = false, repeat = 1) {
  const map = new THREE.CanvasTexture(element);
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.anisotropy = 4;
  return map;
}
function normalMap(height, strength) {
  const size = height.width, input = height.getContext("2d").getImageData(0, 0, size, size).data;
  const output = canvas(size), context = output.getContext("2d"), pixels = context.createImageData(size, size);
  const sample = (x, y) => input[(((y + size) % size) * size + (x + size) % size) * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (sample(x - 1, y) - sample(x + 1, y)) * strength;
    const dy = (sample(x, y - 1) - sample(x, y + 1)) * strength;
    const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    pixels.data[i] = (dx / length * 0.5 + 0.5) * 255;
    pixels.data[i + 1] = (-dy / length * 0.5 + 0.5) * 255;
    pixels.data[i + 2] = (1 / length * 0.5 + 0.5) * 255;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return texture(output);
}
let seed = 1937;
const random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;

export function reptileSurface() {
  const diffuse = canvas(512), relief = canvas(512);
  const c = diffuse.getContext("2d"), h = relief.getContext("2d");
  c.fillStyle = "#424a32"; c.fillRect(0, 0, 512, 512);
  h.fillStyle = "#303030"; h.fillRect(0, 0, 512, 512);
  for (let row = -1; row < 49; row++) for (let column = -1; column < 49; column++) {
    const x = column * 11 + (row % 2) * 5.5 + random() * 2;
    const y = row * 11 + random() * 2;
    const pigment = 29 + random() * 12 + Math.sin(x * 0.028 + Math.sin(y * 0.018) * 2) * 5;
    c.fillStyle = `hsl(${65 + random() * 13},${20 + random() * 10}%,${pigment}%)`;
    c.beginPath(); c.ellipse(x, y, 5 + random(), 4 + random(), random() * 0.4, 0, Math.PI * 2); c.fill();
    const gradient = h.createRadialGradient(x - 1, y - 1, 0, x, y, 6);
    gradient.addColorStop(0, "#d8d8d8"); gradient.addColorStop(0.7, "#a8a8a8"); gradient.addColorStop(1, "#303030");
    h.fillStyle = gradient; h.beginPath(); h.ellipse(x, y, 5.3, 4.6, 0, 0, Math.PI * 2); h.fill();
    c.strokeStyle = "#c1bc8d22"; c.lineWidth = 0.5; c.stroke();
  }
  const normals = normalMap(relief, 2.2);
  normals.repeat.set(2, 2);
  return { map: texture(diffuse, true, 2), normalMap: normals, roughness: 0.78 };
}

export function fabricSurface() {
  const element = canvas(256), c = element.getContext("2d");
  const pixels = c.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const value = 188 + random() * 34 + ((x + (y % 4 < 2 ? 2 : 0)) % 4 < 2 ? 16 : -12);
    const i = (y * 256 + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    pixels.data[i + 3] = 255;
  }
  c.putImageData(pixels, 0, 0);
  return { map: texture(element, true), bumpMap: texture(element), bumpScale: 0.008, roughness: 0.94 };
}

export function leatherSurface() {
  const element = canvas(256), c = element.getContext("2d");
  c.fillStyle = "#c2b5a0"; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    c.fillStyle = random() > 0.35 ? "#51433118" : "#ffffed26";
    c.fillRect(random() * 256, random() * 256, random() * 2 + 0.3, random() * 1.2 + 0.3);
  }
  return { map: texture(element, true), bumpMap: texture(element), bumpScale: 0.012, roughness: 0.78 };
}

export function contactShadowTexture() {
  const element = canvas(128), c = element.getContext("2d"), gradient = c.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, "#15160fd9"); gradient.addColorStop(0.4, "#17170e6b"); gradient.addColorStop(1, "#181a1200");
  c.fillStyle = gradient; c.fillRect(0, 0, 128, 128);
  return texture(element, true);
}
