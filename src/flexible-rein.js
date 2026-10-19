import * as THREE from "three";

const SEGMENTS = 20, SIDES = 6, RADIUS = 0.012;

// A small damped rope simulation with pinned ends. Its tube buffer is reused;
// neither curves nor geometry are allocated during animation.
export class FlexibleRein extends THREE.Mesh {
  constructor(material, side) {
    const geometry = new THREE.BufferGeometry();
    const count = (SEGMENTS + 1) * (SIDES + 1);
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = [], indices = [];
    for (let i = 0; i <= SEGMENTS; i++) for (let j = 0; j <= SIDES; j++) {
      uv.push(j / SIDES, i / SEGMENTS);
      if (i < SEGMENTS && j < SIDES) {
        const a = i * (SIDES + 1) + j, b = a + SIDES + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    super(geometry, material);
    this.side = side;
    this.points = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3());
    this.previous = this.points.map(() => new THREE.Vector3());
    this.velocity = new THREE.Vector3();
    this.delta = new THREE.Vector3();
    this.tangent = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.binormal = new THREE.Vector3();
    this.reference = new THREE.Vector3(1, 0, 0);
    this.userData.keepSeparate = true;
    this.frustumCulled = false;
    this.initialized = false;
    this.length = 0;
  }

  update(start, end, deltaTime = 1 / 60) {
    const dt = Math.min(1 / 30, Math.max(1 / 240, deltaTime));
    if (!this.initialized) {
      this.length = start.distanceTo(end) * 1.09;
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        this.points[i].lerpVectors(start, end, t);
        this.points[i].y -= Math.sin(t * Math.PI) * 0.16;
        this.previous[i].copy(this.points[i]);
      }
      this.initialized = true;
    }
    const segmentLength = Math.max(this.length, start.distanceTo(end) * 1.025) / SEGMENTS;
    for (let i = 1; i < SEGMENTS; i++) {
      const p = this.points[i];
      this.velocity.subVectors(p, this.previous[i]).multiplyScalar(Math.pow(0.88, dt * 60));
      this.previous[i].copy(p);
      p.add(this.velocity);
      p.y -= 9.8 * dt * dt;
    }
    for (let iteration = 0; iteration < 14; iteration++) {
      this.points[0].copy(start);
      this.points[SEGMENTS].copy(end);
      for (let i = 0; i < SEGMENTS; i++) {
        const a = this.points[i], b = this.points[i + 1];
        this.delta.subVectors(b, a);
        const distance = this.delta.length();
        if (distance < 1e-8) continue;
        this.delta.multiplyScalar((distance - segmentLength) / distance);
        if (i === 0) b.sub(this.delta);
        else if (i === SEGMENTS - 1) a.add(this.delta);
        else { a.addScaledVector(this.delta, 0.5); b.addScaledVector(this.delta, -0.5); }
      }
      // Drape along the outside of the neck instead of falling through it.
      for (let i = 1; i < SEGMENTS; i++) {
        const clearance = 0.32 + Math.sin(i / SEGMENTS * Math.PI) * 0.1;
        this.points[i].x = this.side * Math.max(clearance, this.side * this.points[i].x);
      }
    }
    // Exact attachment takes precedence over the interior solver's tolerance.
    this.points[0].copy(start);
    this.points[SEGMENTS].copy(end);
    this.previous[0].copy(start);
    this.previous[SEGMENTS].copy(end);
    this.updateTube();
  }

  updateTube() {
    const positions = this.geometry.attributes.position, normals = this.geometry.attributes.normal;
    for (let i = 0; i <= SEGMENTS; i++) {
      const point = this.points[i];
      this.tangent.subVectors(this.points[Math.min(SEGMENTS, i + 1)], this.points[Math.max(0, i - 1)]).normalize();
      this.normal.crossVectors(this.tangent, this.reference).normalize();
      if (this.normal.lengthSq() < 0.01) this.normal.set(0, 1, 0);
      this.binormal.crossVectors(this.tangent, this.normal).normalize();
      for (let j = 0; j <= SIDES; j++) {
        const angle = j / SIDES * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
        const x = this.normal.x * c + this.binormal.x * s;
        const y = this.normal.y * c + this.binormal.y * s;
        const z = this.normal.z * c + this.binormal.z * s;
        const vertex = i * (SIDES + 1) + j;
        positions.setXYZ(vertex, point.x + x * RADIUS, point.y + y * RADIUS, point.z + z * RADIUS);
        normals.setXYZ(vertex, x, y, z);
      }
    }
    positions.needsUpdate = normals.needsUpdate = true;
  }
}
