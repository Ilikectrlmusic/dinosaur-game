import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Different erosion profiles, rather than scaling one pillar into every rock.
export const ROCK_FORMS = ["mesa", "butte", "spire", "fin", "dome", "cluster"];
export const BOULDER_FORMS = ["rounded", "angular", "slab", "elongated", "layered"];
const profiles = {
  mesa: [[0, 1.14], [0.18, 1.02], [0.45, 0.88], [0.8, 0.81], [0.94, 0.84], [1, 0.72]],
  butte: [[0, 1.2], [0.2, 0.94], [0.44, 0.7], [0.55, 0.73], [0.64, 0.53], [0.88, 0.5], [1, 0.36]],
  spire: [[0, 1.05], [0.2, 0.7], [0.42, 0.55], [0.67, 0.36], [0.88, 0.28], [1, 0.14]],
  fin: [[0, 1.1], [0.22, 1], [0.55, 0.84], [0.82, 0.72], [1, 0.51]],
  dome: [[0, 1], [0.18, 1.04], [0.48, 0.94], [0.72, 0.72], [0.9, 0.43], [1, 0.08]],
};
const sandstone = new THREE.Color("#b98a66"), pale = new THREE.Color("#e1bb95"), dark = new THREE.Color("#8f634d");

function stoneColors(geometry, seed, height) {
  const positions = geometry.attributes.position, colors = [], tint = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const band = Math.sin(y * 1.5 + Math.sin(x * 0.2 + seed) * 0.6 + z * 0.05);
    tint.copy(sandstone).lerp(pale, Math.max(0, band) * 0.48)
      .lerp(dark, Math.max(0, -band) * 0.22 + Math.max(0, 1 - y / height) * 0.1);
    colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

export function rockFormationGeometry(kind, width, height, seed = 0) {
  if (kind === "cluster") {
    const parts = [[0, 0, 0.8, 1], [0.45, 0.06, 0.65, 0.7], [-0.3, 0.25, 0.55, 0.48]]
      .map(([x, z, w, h], i) => rockFormationGeometry("butte", width * w, height * h, seed + i * 4)
        .translate(width * x, 0, width * z));
    const geometry = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    geometry.name = kind;
    geometry.computeBoundingBox();
    return geometry;
  }
  const profile = profiles[kind];
  const geometry = new THREE.CylinderGeometry(1, 1, 1, kind === "fin" ? 20 : 28, 18);
  const p = geometry.attributes.position, phase = seed * 1.731;
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) + 0.5, angle = Math.atan2(p.getZ(i), p.getX(i));
    let radius = profile.at(-1)[1];
    for (let j = 1; j < profile.length; j++) if (h <= profile[j][0]) {
      const t = THREE.MathUtils.smoothstep(h, profile[j - 1][0], profile[j][0]);
      radius = THREE.MathUtils.lerp(profile[j - 1][1], profile[j][1], t);
      break;
    }
    const fluting = 1 + Math.sin(angle * 5 + h * 3 + phase) * 0.065 + Math.cos(angle * 11 - h * 2 + phase) * 0.035;
    const fracture = 1 - Math.max(0, Math.cos(angle * 3 + phase)) ** 14 * 0.12 * h;
    const bands = 1 + Math.sin(h * height * 1.4 + phase) * 0.012;
    radius *= fluting * fracture * bands;
    const lean = kind === "fin" ? height * h * h * 0.12 : Math.sin(phase) * h * width * 0.045;
    p.setXYZ(i, p.getX(i) * radius * width * 0.5 + lean,
      h * height + Math.sin(angle * 4 + phase) * height * 0.018 * h * h,
      p.getZ(i) * radius * width * (kind === "fin" ? 0.18 : 0.44));
  }
  geometry.name = kind;
  return stoneColors(geometry, seed, height);
}

export function boulderGeometry(kind, seed = 0) {
  const geometry = kind === "slab" ? new THREE.BoxGeometry(2, 1, 2, 3, 2, 3)
    : ["angular", "elongated"].includes(kind) ? new THREE.IcosahedronGeometry(1, 1)
      : new THREE.SphereGeometry(1, 12, 7);
  const p = geometry.attributes.position;
  const shape = { rounded: [1, 0.7, 0.9], angular: [1, 0.85, 0.8], slab: [1.25, 0.45, 0.85], elongated: [1.6, 0.45, 0.6], layered: [1.05, 0.65, 0.95] }[kind];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const erosion = 1 + Math.sin(x * 6 + z * 4 + seed) * 0.075 + Math.cos(y * 9 - seed) * 0.04;
    const ledge = kind === "layered" ? 1 + Math.sin(y * 16) * 0.09 : 1;
    p.setXYZ(i, x * shape[0] * erosion * ledge,
      y * shape[1] * erosion + x * 0.035,
      z * shape[2] * erosion * ledge);
  }
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  geometry.name = kind;
  return stoneColors(geometry, seed, 1.7);
}
