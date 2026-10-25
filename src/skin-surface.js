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
  return { group, cell, rows, columns, minY, maxY, minZ, maxZ, left, right,
    frame: new THREE.Matrix4(), inverse: new THREE.Matrix4() };
}

export class SkinSurface {
  constructor(root, groups) {
    this.root = root;
    this.profiles = groups.map((group) => profileFor(group)).filter(Boolean);
    this.rootInverse = new THREE.Matrix4();
    this.point = new THREE.Vector3();
    this.probe = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.update();
  }

  update() {
    this.rootInverse.copy(this.root.matrixWorld).invert();
    for (const profile of this.profiles) {
      profile.frame.multiplyMatrices(this.rootInverse, profile.group.matrixWorld);
      profile.inverse.copy(profile.frame).invert();
    }
  }

  outside(point, side) {
    let outside = -Infinity;
    for (const p of this.profiles) {
      const local = this.point.copy(point).applyMatrix4(p.inverse);
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

  boxRoll(top, half, side) {
    let upper = -Infinity, lower = -Infinity;
    for (const z of [-half.z, 0, half.z]) {
      this.probe.copy(top); this.probe.y -= half.y * 0.25; this.probe.z += z;
      upper = Math.max(upper, this.outside(this.probe, side));
      this.probe.y -= half.y * 1.5;
      lower = Math.max(lower, this.outside(this.probe, side));
    }
    if (!Number.isFinite(upper) || !Number.isFinite(lower)) return 0;
    return side * THREE.MathUtils.clamp(Math.atan2(lower - upper, half.y * 1.5), -0.35, 0.75);
  }

  boxYaw(top, half, side) {
    let front = -Infinity, rear = -Infinity;
    for (const y of [half.y * 0.5, half.y, half.y * 1.5]) {
      this.probe.copy(top); this.probe.y -= y; this.probe.z -= half.z * 0.75;
      front = Math.max(front, this.outside(this.probe, side));
      this.probe.z += half.z * 1.5;
      rear = Math.max(rear, this.outside(this.probe, side));
    }
    if (!Number.isFinite(front) || !Number.isFinite(rear)) return 0;
    return side * THREE.MathUtils.clamp(Math.atan2(rear - front, half.z * 1.5), -0.75, 0.75);
  }

  projectBox(top, half, side, rotation = null) {
    // The last rope point is the box's top fastening, not its centre.
    let correction = 0;
    for (const face of rotation ? [-1, 1] : [-1])
      for (const dy of [0, -half.y, -half.y * 2]) for (const dz of [-half.z, 0, half.z]) {
        this.offset.set(side * face * half.x, dy, dz);
        if (rotation) this.offset.applyQuaternion(rotation);
        this.probe.copy(top).add(this.offset);
        correction = Math.max(correction, this.outside(this.probe, side) + 0.01 - side * this.probe.x);
      }
    top.x += side * correction;
    return correction;
  }
}
