import * as THREE from "three";

export const RIDER_THIGH_LENGTH = 0.56, RIDER_SHIN_LENGTH = 0.50;
const DOWN = new THREE.Vector3(0, -1, 0), STEP = 1 / 120;
const clamp = THREE.MathUtils.clamp;

const particle = (point, mass = 1) => ({ position: point.clone(), previous: point.clone(), inverseMass: mass ? 1 / mass : 0 });
const delta = new THREE.Vector3();
function distance(a, b, length) {
  delta.subVectors(b.position, a.position);
  const actual = delta.length(), weight = a.inverseMass + b.inverseMass;
  if (actual < 1e-8 || !weight) return;
  delta.multiplyScalar((actual - length) / actual / weight);
  a.position.addScaledVector(delta, a.inverseMass);
  b.position.addScaledVector(delta, -b.inverseMass);
}
function integrate(node, h, gravity, forward) {
  if (!node.inverseMass) return;
  delta.subVectors(node.position, node.previous).multiplyScalar(Math.exp(-8 * h));
  node.previous.copy(node.position);
  node.position.add(delta);
  node.position.y += gravity * h * h;
  node.position.z += forward * h * h;
}

// Small reusable leather ribbons. The solver supplies the centreline; the
// fastening points stay exact even when the body compresses at touchdown.
export class SuspensionStrap extends THREE.Mesh {
  constructor(material, segments = 8) {
    const geometry = new THREE.BufferGeometry(), indices = [], uv = [];
    for (let i = 0; i <= segments; i++) for (let j = 0; j < 4; j++) {
      uv.push(j / 3, i / segments);
      if (i < segments) {
        const a = i * 4 + j, b = i * 4 + (j + 1) % 4;
        indices.push(a, b, a + 4, b, b + 4, a + 4);
      }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((segments + 1) * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array((segments + 1) * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
    super(geometry, material);
    this.frustumCulled = false; this.userData.keepSeparate = true;
    this.direction = new THREE.Vector3(); this.width = new THREE.Vector3(); this.normal = new THREE.Vector3();
  }
  update(nodes) {
    const position = this.geometry.attributes.position, normal = this.geometry.attributes.normal;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i].position;
      this.direction.subVectors(nodes[Math.min(i + 1, nodes.length - 1)].position, nodes[Math.max(0, i - 1)].position).normalize();
      this.width.set(0, 0, 1).addScaledVector(this.direction, -this.direction.z).normalize();
      if (this.width.lengthSq() < 0.1) this.width.set(1, 0, 0);
      this.normal.crossVectors(this.direction, this.width).normalize();
      for (let j = 0; j < 4; j++) {
        const w = j === 0 || j === 3 ? -0.019 : 0.019, n = j < 2 ? -0.003 : 0.003;
        position.setXYZ(i * 4 + j, p.x + this.width.x * w + this.normal.x * n,
          p.y + this.width.y * w + this.normal.y * n, p.z + this.width.z * w + this.normal.z * n);
        normal.setXYZ(i * 4 + j, this.normal.x * Math.sign(n), this.normal.y * Math.sign(n), this.normal.z * Math.sign(n));
      }
    }
    position.needsUpdate = normal.needsUpdate = true;
  }
}

class HangingChain {
  constructor(start, end, length, side, strap, box = null, pinnedEnd = false) {
    this.side = side; this.length = length; this.strap = strap; this.box = box; this.pinnedEnd = pinnedEnd;
    this.nodes = Array.from({ length: 9 }, (_, i) => particle(start.clone().lerp(end, i / 8), i === 0 || (i === 8 && pinnedEnd) ? 0 : i === 8 ? 6 : 1));
  }
  constrain(surface) {
    for (let i = 0; i < 8; i++) distance(this.nodes[i], this.nodes[i + 1], this.length / 8);
    for (let i = 1; i < this.nodes.length; i++) {
      if (this.pinnedEnd && i === 8) continue;
      const p = this.nodes[i].position;
      if (i === 8 && this.box) surface.projectBox(p, this.box, this.side);
      else surface.projectSphere(p, 0.024, this.side);
    }
  }
}

// The rider keeps a fitted, stable riding pose. Only the panniers and leather
// straps use gravity and inertia; skin contacts keep the luggage outside.
export class RidingSuspension {
  constructor(dino, surface, panniers, straps) {
    this.dino = dino; this.surface = surface; this.panniers = panniers; this.straps = straps;
    this.accumulator = 0; this.previousVelocity = 0; this.previousSpeed = 14;
    this.point = new THREE.Vector3(); this.direction = new THREE.Vector3();
    this.knee = new THREE.Vector3(); this.pole = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
    this.inverse = new THREE.Quaternion(); this.bootRotation = new THREE.Quaternion();
    this.euler = new THREE.Euler(); this.rider = null; this.chains = [];
  }
  resetRider() {
    const dino = this.dino, scale = dino.sizeScale;
    this.rider = dino.rider;
    // Measure the mount once. Keep a small bend in both knees instead of
    // allowing each moving thigh to push the rider into a different pose.
    let bodyWidth = 0, thighWidth = 0;
    for (const profile of this.surface.profiles) {
      let half = 0;
      for (let i = 0; i < profile.right.length; i++) {
        if (Number.isFinite(profile.right[i])) half = Math.max(half, Math.abs(profile.right[i]), Math.abs(profile.left[i]));
      }
      if (profile.group === dino.body) bodyWidth = half * dino.body.scale.x * scale;
      if (profile.sweep) thighWidth = Math.max(thighWidth, (Math.abs(profile.group.position.x) + half) * scale);
    }
    const footWidth = Math.max(bodyWidth + 0.19, thighWidth * 0.9 + 0.06);
    this.legs = this.rider.limbs.map(({ leg, side }, i) => {
      const hip = leg.position.clone().multiplyScalar(1 / scale).add(this.rider.root.position);
      const reach = RIDER_THIGH_LENGTH + RIDER_SHIN_LENGTH - 0.10;
      const drop = Math.sqrt(Math.max(0.20, reach * reach - (footWidth - Math.abs(leg.position.x)) ** 2 - 0.22 ** 2));
      const foot = new THREE.Vector3(side * footWidth, leg.position.y - drop, leg.position.z - 0.22);
      const pole = new THREE.Vector3(side * 0.30, -0.2, -0.55).multiplyScalar(1 / scale);
      const knee = hip.clone().add(pole);
      const ankle = foot.clone().multiplyScalar(1 / scale).add(this.rider.root.position);
      const start = this.start(side, 0.03), end = ankle.clone();
      const chain = new HangingChain(start, end, 0.97 / scale, side, this.straps[i], null, true);
      return { side, foot, pole, nodes: [particle(hip, 0), particle(knee, 0), particle(ankle, 0)], chain };
    });
    if (!this.chains.length) this.chains = this.panniers.map(({ side, strap }) => {
      const start = this.start(side, 0.65, 0.54);
      return new HangingChain(start, start.clone().add(new THREE.Vector3(side * 0.48, -0.22, 0)), 0.62, side, strap, new THREE.Vector3(0.145, 0.2, 0.205));
    });
    for (let i = 0; i < 100; i++) this.constrain();
    for (const leg of this.legs) leg.nodes.forEach((node) => node.previous.copy(node.position));
    for (const chain of this.chains) chain.nodes.forEach((node) => node.previous.copy(node.position));
    this.accumulator = 0;
  }
  start(side, z, width = 0.44) { return new THREE.Vector3(side * width, this.dino.saddle.position.y + 0.025, z); }

  constrain() {
    for (const chain of this.chains) chain.constrain(this.surface);
  }
  update(dt, verticalVelocity = 0, speed = 14) {
    if (this.rider !== this.dino.rider) this.resetRider();
    const scale = this.dino.sizeScale, step = Math.min(Math.max(dt, 0), 0.05);
    const gravity = (-9.81 - clamp(step ? (verticalVelocity - this.previousVelocity) / step : 0, -8, 18)) / scale;
    const forward = clamp(step ? (speed - this.previousSpeed) / step : 0, -8, 8) / scale;
    this.previousVelocity = verticalVelocity; this.previousSpeed = speed;
    for (const [i, leg] of this.legs.entries()) {
      leg.nodes[0].position.copy(this.rider.limbs[i].leg.position).multiplyScalar(1 / scale).add(this.rider.root.position);
      leg.nodes[1].position.copy(leg.nodes[0].position).add(leg.pole);
      leg.nodes[2].position.copy(leg.foot).multiplyScalar(1 / scale).add(this.rider.root.position);
    }
    this.chains.forEach((chain) => chain.nodes[0].position.copy(this.start(chain.side, 0.65, 0.54)));
    this.accumulator += step;
    while (this.accumulator >= STEP - 1e-8) {
      this.accumulator -= STEP;
      for (const leg of this.legs) {
        leg.chain.nodes.forEach((node) => integrate(node, STEP, gravity, forward));
      }
      for (const chain of this.chains) chain.nodes.forEach((node) => integrate(node, STEP, gravity, forward));
      for (let i = 0; i < 12; i++) this.constrain();
    }
    // Newly selected luggage still needs a fitted surface contact.
    if (!step) for (let i = 0; i < 30; i++) this.constrain();
    this.legs.forEach((leg, i) => this.applyLeg(leg, this.rider.limbs[i]));
    this.chains.forEach((chain, i) => {
      const top = chain.nodes.at(-1).position, bag = this.panniers[i].group;
      // Keep the loaded boxes upright with only a small inertial rock.
      const velocity = top.z - chain.nodes.at(-1).previous.z;
      bag.rotation.x = THREE.MathUtils.damp(bag.rotation.x, clamp(velocity * 7, -0.08, 0.08), 12, step);
      this.point.set(0, 0.2, 0).applyQuaternion(bag.quaternion);
      bag.position.copy(top).sub(this.dino.saddle.position).sub(this.point);
      chain.strap.update(chain.nodes);
    });
    this.dino.root.updateMatrixWorld(true);
  }
  applyLeg(state, limb) {
    const scale = this.dino.sizeScale, [hip, knee, ankle] = state.nodes;
    const l1 = RIDER_THIGH_LENGTH / scale, l2 = RIDER_SHIN_LENGTH / scale;
    this.direction.subVectors(ankle.position, hip.position);
    const reach = clamp(this.direction.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.002);
    this.direction.normalize();
    const along = (l1 * l1 + reach * reach - l2 * l2) / (2 * reach);
    this.pole.subVectors(knee.position, hip.position).addScaledVector(this.direction,
      -this.pole.dot(this.direction)).normalize();
    if (this.pole.lengthSq() < 0.01) this.pole.set(state.side, 0, -1).normalize();
    this.knee.copy(hip.position).addScaledVector(this.direction, along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    ankle.position.copy(hip.position).addScaledVector(this.direction, reach);
    knee.position.copy(this.knee);
    this.direction.subVectors(knee.position, hip.position).normalize();
    limb.leg.quaternion.setFromUnitVectors(DOWN, this.direction);
    this.direction.subVectors(ankle.position, knee.position).normalize();
    this.inverse.copy(limb.leg.quaternion).invert(); this.direction.applyQuaternion(this.inverse);
    limb.knee.quaternion.setFromUnitVectors(DOWN, this.direction);
    this.rotation.copy(limb.leg.quaternion).multiply(limb.knee.quaternion).invert();
    this.euler.set(0.08, state.side * 0.1, 0);
    limb.boot.quaternion.copy(this.rotation).multiply(this.bootRotation.setFromEuler(this.euler));
    const chain = state.chain;
    chain.nodes[0].position.copy(this.start(state.side, 0.03));
    this.point.set(state.side * 0.1, 0.025, -0.02).applyQuaternion(this.bootRotation).multiplyScalar(1 / scale);
    chain.nodes.at(-1).position.copy(ankle.position).add(this.point);
    chain.length = Math.max(0.97 / scale, chain.nodes[0].position.distanceTo(chain.nodes.at(-1).position) * 1.08);
    for (let i = 0; i < 16; i++) chain.constrain(this.surface);
    chain.strap.update(chain.nodes);
  }
}
