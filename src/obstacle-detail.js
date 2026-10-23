import * as THREE from "three";
import { cactusArmPoint, CACTUS_ARM_RADIUS } from "./cactus-shape.js";

// A ribbed continuous sweep, including a hemispherical crown. No cylinders
// intersect at the elbow and the ribs follow the same rounded surface.
export function cactusArmGeometry(height, side) {
  const positions = [], uvs = [], colors = [], indices = [], radial = 32, rings = 24, cap = 6;
  for (let i = 0; i <= rings + cap; i++) {
    const point = cactusArmPoint(height, side, Math.min(i / rings, 1));
    const angle = Math.max(0, i - rings) / cap * Math.PI / 2;
    const radius = CACTUS_ARM_RADIUS * Math.cos(angle);
    const advance = CACTUS_ARM_RADIUS * Math.sin(angle);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      const r = radius * (1 - 0.025 * (1 - Math.cos(a * 8)));
      positions.push(point.x + point.tx * advance - point.ty * Math.cos(a) * r,
        point.y + point.ty * advance + point.tx * Math.cos(a) * r, Math.sin(a) * r);
      uvs.push(j / radial, i / rings);
      const rib = Math.max(0, Math.cos(a * 8)) ** 3;
      colors.push(1 + rib * 0.17, 1 + rib * 0.16, 1 + rib * 0.12);
      if (i < rings + cap && j < radial) {
        const p = i * (radial + 1) + j, n = p + radial + 1;
        indices.push(p, p + 1, n, p + 1, n + 1, n);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Spanwise sections keep the wing's leading spar straight enough to read,
// while the broad membrane has camber and a curved, lightly scalloped edge.
const leading = new THREE.CatmullRomCurve3([
  [0.1, 0.015, -0.28], [0.45, 0.06, -0.43], [0.85, 0.1, -0.6],
  [1.3, 0.09, -0.73], [1.7, 0.045, -0.83], [2.05, 0, -0.9],
].map((point) => new THREE.Vector3(...point)));
const trailing = new THREE.CatmullRomCurve3([
  [0.1, -0.02, 0.35], [0.45, -0.035, 0.53], [0.85, -0.045, 0.43],
  [1.3, -0.04, 0.23], [1.7, -0.02, -0.12], [2.05, 0, -0.9],
].map((point) => new THREE.Vector3(...point)));

export function wingPoint(side, u, v) {
  const point = leading.getPoint(u).lerp(trailing.getPoint(u), v);
  point.y += 0.095 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u);
  point.z -= 0.025 * Math.sin(u * Math.PI * 5) ** 2 * Math.sin(Math.PI * u) * v ** 4;
  point.x *= side;
  return point;
}

export function wingMembraneGeometry(side) {
  const positions = [], uvs = [], colors = [], indices = [], span = 40, chord = 12;
  for (let i = 0; i <= span; i++) for (let j = 0; j <= chord; j++) {
    const u = i / span, v = j / chord, point = wingPoint(side, u, v);
    positions.push(...point.toArray());
    uvs.push(u * 2, v);
    const shade = 1 - v * 0.16 + Math.sin(u * 31 + v * 5) * 0.025;
    colors.push(shade, shade * (0.93 + v * 0.04), shade * 0.87);
    if (i < span && j < chord) {
      const p = i * (chord + 1) + j, n = p + chord + 1;
      if (side === 1) indices.push(p, p + 1, n, p + 1, n + 1, n);
      else indices.push(p, n, p + 1, p + 1, n, n + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
