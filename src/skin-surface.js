import * as THREE from "three";

// Bake the actual meshes once into small side profiles. Animated part frames
// move the profiles with the animal; runtime contact needs no triangle casts.
function profileFor(group, cell = 0.035) {
  const vertices = [], point = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const mesh of group.children) {
    if (!mesh.isMesh || mesh.userData.keepSeparate) continue;
    mesh.updateMatrix();
    const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
    const count = indices ? indices.count : positions.count;
    for (let i = 0; i < count; i++) {
      point.fromBufferAttribute(positions, indices ? indices.getX(i) : i).applyMatrix4(mesh.matrix);
      vertices.push(point.x, point.y, point.z);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
    }
  }
  if (!vertices.length) return null;
  const rows = Math.ceil((maxY - minY) / cell) + 2, columns = Math.ceil((maxZ - minZ) / cell) + 2;
  const left = new Float32Array(rows * columns).fill(Infinity);
  const right = new Float32Array(rows * columns).fill(-Infinity);
  for (let i = 0; i < vertices.length; i += 9) {
    const ys = [vertices[i + 1], vertices[i + 4], vertices[i + 7]];
    const zs = [vertices[i + 2], vertices[i + 5], vertices[i + 8]];
    const lo = Math.min(vertices[i], vertices[i + 3], vertices[i + 6]);
    const hi = Math.max(vertices[i], vertices[i + 3], vertices[i + 6]);
    const y0 = Math.floor((Math.min(...ys) - minY) / cell), y1 = Math.ceil((Math.max(...ys) - minY) / cell);
    const z0 = Math.floor((Math.min(...zs) - minZ) / cell), z1 = Math.ceil((Math.max(...zs) - minZ) / cell);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const index = y * columns + z;
      left[index] = Math.min(left[index], lo); right[index] = Math.max(right[index], hi);
    }
  }
  let sweep = null;
  if (group.userData.suspensionSweep) {
    // The mount's muscular thigh passes beneath a hanging foot every stride.
    // Reserve its swept skin contour so the boot/bag does not first drift
    // inward and then get kicked out by the next advancing thigh.
    const radialLeft = new Float32Array(64).fill(Infinity), radialRight = new Float32Array(64).fill(-Infinity);
    const edgeDistance = (ay, az, by, bz) => {
      const dy = by - ay, dz = bz - az;
      const t = THREE.MathUtils.clamp(-(ay * dy + az * dz) / Math.max(1e-12, dy * dy + dz * dz), 0, 1);
      return Math.hypot(ay + dy * t, az + dz * t);
    };
    for (let i = 0; i < vertices.length; i += 9) {
      const ay = vertices[i + 1], az = vertices[i + 2], by = vertices[i + 4], bz = vertices[i + 5], cy = vertices[i + 7], cz = vertices[i + 8];
      const crosses = [ay * bz - az * by, by * cz - bz * cy, cy * az - cz * ay];
      const contains = crosses.every((n) => n >= 0) || crosses.every((n) => n <= 0);
      const low = contains ? 0 : Math.min(edgeDistance(ay, az, by, bz), edgeDistance(by, bz, cy, cz), edgeDistance(cy, cz, ay, az));
      const high = Math.max(Math.hypot(ay, az), Math.hypot(by, bz), Math.hypot(cy, cz));
      const lo = Math.min(vertices[i], vertices[i + 3], vertices[i + 6]), hi = Math.max(vertices[i], vertices[i + 3], vertices[i + 6]);
      for (let r = Math.floor(low / cell); r <= Math.ceil(high / cell); r++) {
        radialLeft[r] = Math.min(radialLeft[r], lo); radialRight[r] = Math.max(radialRight[r], hi);
      }
    }
    sweep = { left: radialLeft, right: radialRight };
  }
  return { group, cell, rows, columns, minY, maxY, minZ, maxZ, left, right, sweep,
    frame: new THREE.Matrix4(), inverse: new THREE.Matrix4() };
}

export class SkinSurface {
  constructor(root, groups) {
    this.root = root;
    this.profiles = groups.map((group) => profileFor(group)).filter(Boolean);
    this.rootInverse = new THREE.Matrix4();
    this.point = new THREE.Vector3();
    this.probe = new THREE.Vector3();
    this.update();
  }

  update() {
    this.rootInverse.copy(this.root.matrixWorld).invert();
    for (const profile of this.profiles) {
      profile.frame.multiplyMatrices(this.rootInverse, profile.group.matrixWorld);
      profile.inverse.copy(profile.frame).invert();
    }
  }

  outside(point, side, swept = false) {
    let outside = -Infinity;
    for (const p of this.profiles) {
      const local = this.point.copy(point).applyMatrix4(p.inverse);
      if (p.sweep) {
        const r = Math.hypot(local.y, local.z) / p.cell, index = Math.floor(r), fraction = r - index;
        const field = side === 1 ? p.sweep.right : p.sweep.left;
        const a = field[index], b = field[index + 1];
        if (Number.isFinite(a) && Number.isFinite(b)) {
          const x = THREE.MathUtils.lerp(a, b, fraction);
          const crown = swept ? 0 : THREE.MathUtils.smoothstep(point.y - p.frame.elements[13], 0.2, 0.65);
          outside = Math.max(outside, side * (p.frame.elements[12] + x * p.frame.elements[0]) - crown * 0.9);
        }
      }
      if (local.y < p.minY || local.y > p.maxY || local.z < p.minZ || local.z > p.maxZ) continue;
      const y = (local.y - p.minY) / p.cell, z = (local.z - p.minZ) / p.cell;
      const iy = Math.floor(y), iz = Math.floor(z), fy = y - iy, fz = z - iz;
      let value = 0, weight = 0;
      const field = side === 1 ? p.right : p.left;
      for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
        const sample = field[(iy + dy) * p.columns + iz + dz];
        const w = (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        if (Number.isFinite(sample)) { value += sample * w; weight += w; }
      }
      if (weight < 0.001) continue;
      local.x = value / weight;
      local.applyMatrix4(p.frame);
      outside = Math.max(outside, side * local.x);
    }
    return outside;
  }

  sphereClearance(point, radius, side) {
    let required = this.outside(point, side) + radius;
    const offset = radius * 0.72, rim = radius * 0.7;
    for (const axis of ["y", "z"]) for (const sign of [-1, 1]) {
      this.probe.copy(point); this.probe[axis] += sign * offset;
      required = Math.max(required, this.outside(this.probe, side) + rim);
    }
    return required + 0.012;
  }

  projectSphere(point, radius, side) {
    const correction = Math.max(0, this.sphereClearance(point, radius, side) - side * point.x);
    point.x += side * correction;
    return correction;
  }

  projectBox(top, half, side) {
    // The last rope point is the box's top fastening, not its centre.
    let required = -Infinity;
    for (const dy of [0, -half.y, -half.y * 2]) for (const dz of [-half.z, 0, half.z]) {
      this.probe.copy(top); this.probe.y += dy; this.probe.z += dz;
      required = Math.max(required, this.outside(this.probe, side, true) + half.x + 0.025);
    }
    const correction = Math.max(0, required - side * top.x);
    top.x += side * correction;
    return correction;
  }
}
