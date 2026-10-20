import * as THREE from "three";
import { buildCactus, buildPterosaur } from "./creatures.js";
import { terrainHeight, createAtmosphere, enhanceGround, createBadlands,
  createVegetation, createRockField, updateLandscape } from "./landscape-detail.js";

export const rand = (min, max) => min + Math.random() * (max - min);
const temp = new THREE.Object3D();
function sandTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#b49972";
  ctx.fillRect(0, 0, 512, 512);
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(75,58,38,${rand(0.01, 0.07)})`;
    ctx.lineWidth = rand(0.3, 1);
    ctx.beginPath();
    const y = rand(0, 512);
    for (let x = 0; x < 512; x += 5)
      ctx.lineTo(x, y + Math.sin(x * 0.025 + i) * 2.7);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 90);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function rockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 0),
    p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const noise =
      1 + 0.13 * Math.sin(x * 8 + z * 7) + 0.08 * Math.cos(y * 10 + x * 2);
    p.setXYZ(i, x * noise, y * noise, z * noise);
  }
  geo.computeVertexNormals();
  return geo;
}

export class DesertWorld {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2("#cfb99d", 0.0036);
    this.moving = [];
    this.decorations = [];
    this.distance = 0;
    const hemi = new THREE.HemisphereLight("#d8e4ed", "#897054", 1.2);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight("#ffe0b5", 3.2);
    this.sun.position.set(-40, 35, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -25;
    this.sun.shadow.camera.right = 25;
    this.sun.shadow.camera.top = 25;
    this.sun.shadow.camera.bottom = -25;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 150;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const fill = new THREE.DirectionalLight("#c6dce5", 0.7);
    fill.position.set(10, 12, 14);
    this.scene.add(fill);
    this.createSky(renderer);
    this.sand = sandTexture();
    const geo = new THREE.PlaneGeometry(650, 950, 150, 220);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      p.setY(i, terrainHeight(x, z - 240));
    }
    geo.computeVertexNormals();
    const ground = this.ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        map: this.sand,
        color: "#dbbc8a",
        roughness: 1,
        bumpMap: this.sand,
        bumpScale: 0.09,
      }),
    );
    ground.position.z = -240;
    ground.receiveShadow = true;
    this.scene.add(ground);
    enhanceGround(this, ground);
    this.createTrail();
    this.createRocks();
    this.createMountains();
    this.createPlants();
    this.createDust();
    this.flock = [];
    for (let i = 0; i < 4; i++) {
      const bird = buildPterosaur();
      bird.position.set(30 + i * 13, 25 + i * 4, -110 - i * 15);
      bird.scale.setScalar(0.6);
      this.scene.add(bird);
      this.flock.push(bird);
    }
    this.renderer = renderer;
    this.ready = Promise.all(this.surfaceTasks || []);
  }
  setQuality(quality) {
    this.quality = quality;
    this.scene.environment = quality === "high" ? this.environmentTarget.texture : null;
    const count = quality === "high" ? 4200 : 2400;
    this.grassBlades.count = count;
    this.grassTwin.children[0].count = count;
    this.setRenderScale(1);
  }
  setRenderScale(scale) {
    const fullSize = this.quality === "high" && innerWidth >= 700 ? 2048 : 1024;
    const shadowSize = scale < (fullSize === 2048 ? 0.85 : 0.7) ? fullSize / 2 : fullSize;
    if (this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }
  createSky(renderer) { createAtmosphere(this, renderer); }
  createTrail() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 256, 512);
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, "#8d795000");
    g.addColorStop(0.2, "#ac8f5c18");
    g.addColorStop(0.4, "#9f805536");
    g.addColorStop(0.6, "#9f805536");
    g.addColorStop(0.8, "#ac8f5c18");
    g.addColorStop(1, "#8d795000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(80,67,43,${Math.random() * 0.05})`;
      ctx.beginPath();
      ctx.ellipse(
        rand(50, 205),
        rand(0, 512),
        rand(0.4, 1.5),
        rand(1, 3),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(c);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 35);
    texture.colorSpace = THREE.SRGBColorSpace;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 700),
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        roughness: 1,
      }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.013, -260);
    road.receiveShadow = true;
    this.scene.add(road);
    this.roadTexture = texture;
    // Scattered pebbles line a subtle natural track instead of painted lanes.
    const pebble = new THREE.InstancedMesh(
      rockGeometry(),
      new THREE.MeshStandardMaterial({ color: "#9d8c6b", roughness: 1 }),
      240,
    );
    for (let i = 0; i < 240; i++) {
      const side = i % 2 ? 1 : -1;
      temp.position.set(side * rand(2.7, 4.2), 0.02, rand(-260, 60));
      temp.scale.set(rand(0.025, 0.12), rand(0.025, 0.07), rand(0.04, 0.16));
      temp.rotation.set(Math.random(), Math.random(), Math.random());
      temp.updateMatrix();
      pebble.setMatrixAt(i, temp.matrix);
    }
    pebble.receiveShadow = true;
    this.scene.add(pebble);
    this.pebbles = pebble;
  }
  createRocks() { createRockField(this); }
  createMountains() { createBadlands(this); }
  createPlants() { createVegetation(this, buildCactus); }
  groundHeightAt(x, z) {
    // Interpolate the rendered triangles, including the ground mesh's placement.
    // Sampling the smooth formula alone can leave plants above a coarse triangle.
    const { width, height, widthSegments: columns, heightSegments: rows } = this.ground.geometry.parameters;
    const gx = THREE.MathUtils.clamp((x - this.ground.position.x + width / 2) / width * columns, 0, columns);
    const gz = THREE.MathUtils.clamp((z - this.ground.position.z + height / 2) / height * rows, 0, rows);
    const column = Math.min(Math.floor(gx), columns - 1), row = Math.min(Math.floor(gz), rows - 1);
    const u = gx - column, v = gz - row;
    const vertices = this.ground.geometry.attributes.position;
    const a = row * (columns + 1) + column, b = a + columns + 1;
    const ya = vertices.getY(a), yb = vertices.getY(b), yc = vertices.getY(b + 1), yd = vertices.getY(a + 1);
    return this.ground.position.y + (u + v <= 1
      ? ya + (yd - ya) * u + (yb - ya) * v
      : yc + (yb - yc) * (1 - u) + (yd - yc) * (1 - v));
  }
  createDust() {
    const positions = new Float32Array(220 * 3);
    for (let i = 0; i < 220; i++) {
      positions[i * 3] = rand(-60, 60);
      positions[i * 3 + 1] = rand(0.1, 8);
      positions[i * 3 + 2] = rand(-110, 30);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d"),
      g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "#ffedd5aa");
    g.addColorStop(1, "#ffedd500");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: "#e8d4aa",
        size: 0.14,
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    this.scene.add(this.dust);
    this.puffTexture = new THREE.CanvasTexture(canvas);
    const puffGeo = new THREE.BufferGeometry(),
      puffPositions = new Float32Array(80 * 3);
    puffGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(puffPositions, 3),
    );
    this.puffs = new THREE.Points(
      puffGeo,
      new THREE.PointsMaterial({
        color: "#c0a47d",
        map: this.puffTexture,
        size: 0.8,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    this.scene.add(this.puffs);
    this.puffData = Array.from({ length: 80 }, () => ({
      x: 0,
      y: -10,
      z: 0,
      life: 0,
      vx: 0,
    }));
  }
  emitDust(x, z, amount = 3) {
    for (let j = 0; j < amount; j++) {
      const p = this.puffData.find((p) => p.life <= 0);
      if (p) {
        p.x = x + rand(-0.3, 0.3);
        p.y = 0.12;
        p.z = z + rand(-0.2, 0.3);
        p.life = 1;
        p.vx = rand(-0.6, 0.6);
      }
    }
  }
  update(dt, time, speed = 0, mountHeight = 0) {
    this.distance += speed * dt;
    // On these horizontal planes, V decreases toward +Z. Increasing the
    // texture offset keeps surface details moving with the plants toward +Z.
    this.sand.offset.y = (this.distance / 950) * this.sand.repeat.y;
    this.roadTexture.offset.y = (this.distance / 700) * this.roadTexture.repeat.y;
    this.plants.forEach((p) => {
      p.position.z += speed * dt;
      if (p.position.z > 55) {
        p.position.z -= 260;
      }
      p.position.y = this.groundHeightAt(p.position.x, p.position.z);
    });
    updateLandscape(this, time, mountHeight);
    this.pebbles.position.z = this.distance % 80;
    this.flock.forEach((bird, i) => {
      bird.position.x = 30 + Math.sin(time * 0.06 + i) * 22;
      bird.position.y = 27 + i * 3 + Math.sin(time * 0.8 + i);
      bird.rotation.z = Math.sin(time * 0.2 + i) * 0.1;
      bird.userData.wings.forEach(
        (w, j) =>
          (w.rotation.z = Math.sin(time * 2.5 + i) * (j ? 1 : -1) * 0.18),
      );
    });
    const pp = this.dust.geometry.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      let z = pp.getZ(i) + dt * (speed * 0.7 + 0.7);
      if (z > 35) z = -110;
      pp.setZ(i, z);
      pp.setX(i, pp.getX(i) + Math.sin(time + i) * dt * 0.08);
    }
    pp.needsUpdate = true;
    const p = this.puffs.geometry.attributes.position;
    this.puffData.forEach((d, i) => {
      d.life -= dt * 0.7;
      if (d.life > 0) {
        d.x += d.vx * dt;
        d.y += dt * 0.45;
        d.z += speed * dt * 0.6 + dt;
      }
      p.setXYZ(i, d.x, d.life > 0 ? d.y : -100, d.z);
    });
    p.needsUpdate = true;
  }
}
