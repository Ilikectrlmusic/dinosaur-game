import * as THREE from "three";
import * as CANNON from "cannon-es";

// A connected ragdoll uses the rendered world transforms at the instant of impact.
// The obstacle remains a physical collider, and each joint has limited cone/twist motion.
export class CrashPhysics {
  constructor(scene, dino, speed, obstacle, onImpact) {
    this.scene = scene;
    this.dino = dino;
    this.objects = [];
    this.elapsed = 0;
    this.onImpact = onImpact;
    try {
      this.build(scene, dino, speed, obstacle, onImpact);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  build(scene, dino, speed, obstacle, onImpact) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16, 0) });
    this.world.solver.iterations = 16;
    this.world.allowSleep = true;
    const material = new CANNON.Material("skin"),
      groundMaterial = new CANNON.Material("sand");
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(material, groundMaterial, {
        friction: 0.65,
        restitution: 0.025,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(material, material, {
        friction: 0.5,
        restitution: 0.025,
      }),
    );
    this.material = material;
    const floor = new CANNON.Body({
      mass: 0,
      material: groundMaterial,
      shape: new CANNON.Plane(),
    });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floor);
    this.dino.root.updateMatrixWorld(true);
    const velocity = new CANNON.Vec3(
      obstacle.position.x < dino.root.position.x ? 0.8 : -0.8,
      1.2,
      -speed * 0.7,
    );
    this.velocity = velocity;
    const body = this.part(dino.body, 52, [0.55, 0.58, 1.13]);
    const neck = this.part(dino.neck, 8, [0.28, 0.53, 0.32]);
    const head = this.part(
      dino.head,
      12,
      dino.headCollision?.size || [0.29, 0.28, 0.67],
      dino.headCollision?.offset || [0, -0.02, -0.35],
    );
    this.connect(body, neck, [0, 2.35, -0.7], 0.45);
    this.connect(neck, head, [0, 2.9, -1.35], 0.5);
    const tailParts = [];
    // Detach from the tip first so nested tail segments remain separate bodies.
    for (let i = dino.tail.length - 1; i >= 0; i--) {
      const joint = dino.tail[i];
      tailParts[i] = this.part(
        joint,
        2.5 - i * 0.22,
        [0.26 * (1 - i / 9), 0.23 * (1 - i / 9), 0.29],
        [0, 0, 0.24],
      );
    }
    for (let i = 0; i < tailParts.length; i++) {
      const a = i ? tailParts[i - 1] : body,
        b = tailParts[i];
      this.connectAtMidpoint(a, b, 0.4);
    }
    dino.legs.forEach(({ hip, shin, foot }) => {
      const f = this.part(foot, 2, [0.24, 0.1, 0.4], [0, 0, -0.2]);
      const sh = this.part(shin, 5, [0.13, 0.42, 0.15], [0, -0.4, 0.14]);
      const thigh = this.part(hip, 10, [0.26, 0.45, 0.3], [0, -0.24, -0.08]);
      this.connectAtMidpoint(body, thigh, 0.75);
      this.connectAtMidpoint(thigh, sh, 0.75);
      this.connectAtMidpoint(sh, f, 0.5);
    });
    const bags = dino.panniers.map(({ group }) => this.part(group, 1.8, [0.14, 0.19, 0.19]));
    this.saddle = this.part(dino.saddle, 3, [0.45, 0.12, 0.5]);
    this.connectAtMidpoint(body, this.saddle, 0.08);
    for (const bag of bags) {
      const tether = new CANNON.DistanceConstraint(this.saddle, bag, this.saddle.position.distanceTo(bag.position), 8e3);
      tether.collideConnected = false;
      this.world.addConstraint(tether);
    }
    const rider = dino.rider;
    const hips = this.part(rider.pelvis, 6, [0.23, 0.15, 0.19]);
    const torso = this.part(rider.torso, 10, [0.25, 0.35, 0.19]);
    const riderHead = this.part(rider.head, 3, [0.18, 0.24, 0.18]);
    this.connectAtMidpoint(hips, torso, 0.35);
    this.connectAtMidpoint(torso, riderHead, 0.55);
    rider.limbs.forEach(({ arm, leg, knee }) => {
      const armBody = this.part(arm, 2, [0.09, 0.25, 0.1], [0, -0.2, -0.16]);
      this.connectAtMidpoint(torso, armBody, 1.1);
      const hipAnchor = leg.getWorldPosition(new THREE.Vector3()), kneeAnchor = knee.getWorldPosition(new THREE.Vector3());
      // Detach the calf first to retain the fitted joint pose at impact.
      const calfBody = this.part(knee, 2, [0.11, 0.30, 0.16], [0, -0.28, -0.025]);
      const legBody = this.part(leg, 2, [0.13, 0.28, 0.13], [0, -0.28, 0]);
      this.connectAtPoint(hips, legBody, hipAnchor, 0.95);
      this.connectAtPoint(legBody, calfBody, kneeAnchor, 0.85);
    });
    // The rider is thrown by inertia while the mount's chest decelerates.
    hips.velocity.set(velocity.x * 1.4, 3.4, -speed * 0.94);
    torso.velocity.set(velocity.x * 1.4, 3.8, -speed * 0.94);
    riderHead.velocity.set(velocity.x * 1.4, 4, -speed * 0.94);
    body.angularVelocity.set(-2.6, velocity.x * 0.5, velocity.x * 0.4);
    head.angularVelocity.set(-1.2, 0, 0.4);
    dino.reins.forEach((r) => (r.visible = false));
    [...dino.stirrupStraps, ...dino.panniers.map(({ strap }) => strap)].forEach((strap) => { strap.visible = false; });
    this.centerBody = body;
    this.riderBody = torso;
    const obstacleBody = new CANNON.Body({
      mass: obstacle.userData.type === "bird" ? 3 : 0,
      material: groundMaterial,
    });
    if (obstacle.userData.type === "bird") {
      obstacleBody.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.2, 0.5)));
      obstacleBody.position.copy(obstacle.position);
      obstacleBody.velocity.set(0, 1, speed * 0.3);
      obstacleBody.angularVelocity.set(2, 0, 3);
      this.objects.push({
        object: obstacle,
        body: obstacleBody,
        offset: new THREE.Vector3(),
      });
    } else {
      const members = obstacle.userData.members || [{ x: 0, z: 0, height: obstacle.userData.height }];
      for (const { x, z, height } of members) {
        obstacleBody.addShape(
          new CANNON.Cylinder(0.18, 0.18, height, 10),
          new CANNON.Vec3(x, height / 2, z),
        );
      }
      obstacleBody.position.copy(obstacle.position);
    }
    this.world.addBody(obstacleBody);
    let lastImpact = 0;
    body.addEventListener("collide", (e) => {
      const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (impact > 2 && this.elapsed - lastImpact > 0.25) {
        lastImpact = this.elapsed;
        onImpact?.(body.position, impact);
      }
    });
  }
  part(object, mass, halfExtents, offset = [0, 0, 0]) {
    object.updateWorldMatrix(true, false);
    const scale = object.getWorldScale(new THREE.Vector3());
    const pos = object.getWorldPosition(new THREE.Vector3()),
      quat = object.getWorldQuaternion(new THREE.Quaternion());
    this.scene.attach(object);
    const part = { object, body: null };
    this.objects.push(part);
    const body = new CANNON.Body({
      mass,
      material: this.material,
      linearDamping: 0.22,
      angularDamping: 0.5,
      sleepSpeedLimit: 0.12,
    });
    const local = new CANNON.Vec3(offset[0] * scale.x, offset[1] * scale.y, offset[2] * scale.z);
    body.addShape(new CANNON.Box(new CANNON.Vec3(halfExtents[0] * scale.x, halfExtents[1] * scale.y, halfExtents[2] * scale.z)), local);
    body.position.copy(pos);
    body.quaternion.copy(quat);
    body.velocity.copy(this.velocity);
    this.world.addBody(body);
    part.body = body;
    return body;
  }
  connect(a, b, anchor, angle) {
    const worldAnchor = this.dino.root.localToWorld(new THREE.Vector3(...anchor));
    const point = new CANNON.Vec3(worldAnchor.x, worldAnchor.y, worldAnchor.z);
    const pivotA = a.pointToLocalFrame(point),
      pivotB = b.pointToLocalFrame(point);
    const joint = new CANNON.ConeTwistConstraint(a, b, {
      pivotA,
      pivotB,
      axisA: new CANNON.Vec3(0, 1, 0),
      axisB: new CANNON.Vec3(0, 1, 0),
      angle,
      twistAngle: angle * 0.6,
      maxForce: 1e5,
      collideConnected: false,
    });
    this.world.addConstraint(joint);
  }
  connectAtMidpoint(a, b, angle) {
    this.connectAtPoint(a, b, a.position.vadd(b.position).scale(0.5), angle);
  }
  connectAtPoint(a, b, anchor, angle) {
    const point = new CANNON.Vec3(anchor.x, anchor.y, anchor.z), pivotA = a.pointToLocalFrame(point),
      pivotB = b.pointToLocalFrame(point);
    const joint = new CANNON.ConeTwistConstraint(a, b, {
      pivotA,
      pivotB,
      axisA: new CANNON.Vec3(0, 1, 0),
      axisB: new CANNON.Vec3(0, 1, 0),
      angle,
      twistAngle: angle * 0.6,
      maxForce: 1e5,
      collideConnected: false,
    });
    this.world.addConstraint(joint);
  }
  update(dt) {
    this.elapsed += dt;
    this.world.step(1 / 90, Math.min(dt, 0.25), 24);
    this.objects.forEach(({ object, body }) => {
      object.position.copy(body.position);
      object.quaternion.copy(body.quaternion);
    });
  }
  dispose() {
    const geometries = new Set(),
      materials = new Set();
    this.objects.forEach(({ object }) => {
      this.scene.remove(object);
      object.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        if (Array.isArray(o.material))
          o.material.forEach((material) => materials.add(material));
        else if (o.material) materials.add(o.material);
      });
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.objects = [];
  }
}
