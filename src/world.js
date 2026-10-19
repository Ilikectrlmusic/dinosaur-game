import * as THREE from "three";
import { buildCactus, buildPterosaur } from "./creatures.js";

export const rand = (min, max) => min + Math.random() * (max - min);
const temp = new THREE.Object3D();
function terrainHeight(x, z) {
  const edge = THREE.MathUtils.smoothstep(Math.abs(x), 7, 32);
  return (
    (Math.sin(x * 0.041 + z * 0.017) * 3.5 +
      Math.cos(z * 0.032 - x * 0.009) * 2.2 +
      Math.sin(x * 0.078 + z * 0.04) * 1.1) *
      edge -
    0.04
  );
}
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
  const geo = new THREE.IcosahedronGeometry(1, 2),
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
    this.scene.fog = new THREE.FogExp2("#e1d2b5", 0.006);
    this.moving = [];
    this.decorations = [];
    this.distance = 0;
    const hemi = new THREE.HemisphereLight("#e4edec", "#796349", 2.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight("#ffdab0", 3.3);
    this.sun.position.set(-40, 42, -35);
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
    const fill = new THREE.DirectionalLight("#f4e4ca", 1.65);
    fill.position.set(10, 12, 14);
    this.scene.add(fill);
    this.createSky();
    this.sand = sandTexture();
    const geo = new THREE.PlaneGeometry(650, 950, 150, 220);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      p.setY(i, terrainHeight(x, z));
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(
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
  }
  createSky() {
    const geo = new THREE.SphereGeometry(450, 32, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color("#6d97a5") },
        horizon: { value: new THREE.Color("#eed9b4") },
        bottom: { value: new THREE.Color("#c7ac83") },
        sunDir: { value: new THREE.Vector3(-0.6, 0.34, -0.72).normalize() },
      },
      vertexShader:
        "varying vec3 vWorld; void main(){vWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `varying vec3 vWorld;uniform vec3 top;uniform vec3 horizon;uniform vec3 bottom;uniform vec3 sunDir;void main(){vec3 d=normalize(vWorld);float h=max(d.y,0.);vec3 col=mix(horizon,top,pow(h,.28));if(d.y<0.)col=mix(horizon,bottom,min(-d.y*3.,1.));float sun=max(dot(d,sunDir),0.);col+=vec3(.75,.36,.12)*pow(sun,15.)*.3;col=mix(col,vec3(1.,.92,.7),smoothstep(.9991,.9995,sun));float clouds=sin(d.x*12.+d.z*7.)*sin(d.z*24.-d.x*13.)*.5+.5;col+=vec3(.09,.07,.04)*clouds*smoothstep(.01,.2,d.y)*(1.-smoothstep(.2,.6,d.y));gl_FragColor=vec4(col,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
  }
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
  createRocks() {
    const rock = new THREE.InstancedMesh(
      rockGeometry(),
      new THREE.MeshStandardMaterial({ color: "#9a8569", roughness: 1 }),
      155,
    );
    for (let i = 0; i < 155; i++) {
      const x = (i % 2 ? 1 : -1) * rand(9, 110),
        z = rand(-300, 100);
      temp.position.set(x, terrainHeight(x, z + 240) - 0.02, z);
      const s = rand(0.15, 1.8);
      temp.scale.set(s * rand(0.8, 1.7), s * 0.65, s);
      temp.rotation.set(rand(0, 0.2), rand(0, 7), rand(-0.2, 0.2));
      temp.updateMatrix();
      rock.setMatrixAt(i, temp.matrix);
    }
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.scene.add(rock);
    this.rocks = rock;
  }
  createMountains() {
    const material = new THREE.MeshStandardMaterial({
      color: "#b68f72",
      roughness: 1,
    });
    const distant = new THREE.MeshStandardMaterial({
      color: "#aa9781",
      roughness: 1,
    });
    for (let i = 0; i < 22; i++) {
      const group = new THREE.Group(),
        side = i % 2 ? 1 : -1;
      const h = rand(12, 29),
        w = rand(12, 24);
      // Layered eroded mesas with sloping talus at the foot.
      const baseGeo = new THREE.CylinderGeometry(
        w * 0.52,
        w * 1.2,
        h * 0.65,
        12,
        7,
      );
      const pos = baseGeo.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        const x = pos.getX(j),
          y = pos.getY(j),
          z = pos.getZ(j);
        pos.setXYZ(
          j,
          x * (1 + 0.06 * Math.sin(y * 2 + z)),
          y + Math.sin(x * 3 + z) * 0.35,
          z * (1 + 0.05 * Math.cos(y * 3 + x)),
        );
      }
      baseGeo.computeVertexNormals();
      const base = new THREE.Mesh(baseGeo, i > 11 ? distant : material);
      base.position.y = h * 0.325 - 1;
      group.add(base);
      const topGeo = new THREE.CylinderGeometry(
        w * 0.37,
        w * 0.51,
        h * 0.5,
        12,
        14,
      );
      const pp = topGeo.attributes.position;
      for (let j = 0; j < pp.count; j++) {
        const x = pp.getX(j),
          y = pp.getY(j),
          z = pp.getZ(j);
        const wave = 1 + Math.sin(y * 2.3) * 0.025 + Math.cos(z * 3 + x) * 0.04;
        pp.setXYZ(j, x * wave, y + Math.sin(x * 4 + z * 3) * 0.25, z * wave);
      }
      topGeo.computeVertexNormals();
      const top = new THREE.Mesh(topGeo, i > 11 ? distant : material);
      top.position.y = h * 0.73;
      group.add(top);
      for (let j = 0; j < 5; j++) {
        const stripe = new THREE.Mesh(
          new THREE.CylinderGeometry(
            w * (0.39 + j * 0.019),
            w * (0.4 + j * 0.019),
            0.12,
            7,
          ),
          new THREE.MeshStandardMaterial({
            color: j % 2 ? "#9e785d" : "#b99372",
            roughness: 1,
          }),
        );
        stripe.position.y = h * 0.8 - j * h * 0.07;
        group.add(stripe);
      }
      group.position.set(
        side * (50 + Math.floor(i / 2) * 12),
        rand(-2, 1),
        -90 - Math.floor(i / 2) * 25,
      );
      group.rotation.y = rand(0, 6.3);
      group.scale.z = rand(0.6, 1.1);
      this.scene.add(group);
    }
    // Slender hoodoos nearer to the trail frame the horizon.
    for (let i = 0; i < 7; i++) {
      const s = i % 2 ? 1 : -1,
        x = s * rand(24, 55),
        z = rand(-110, -20),
        h = rand(5, 12);
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(rand(1.4, 2), rand(2, 3.8), h, 7, 4),
        material,
      );
      pillar.position.set(x, h / 2 - 1, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);
      const cap = new THREE.Mesh(rockGeometry(), material);
      cap.scale.set(rand(2.5, 3.8), 1.2, rand(2, 3));
      cap.position.set(x, h - 0.5, z);
      cap.castShadow = true;
      this.scene.add(cap);
    }
  }
  createPlants() {
    this.plants = [];
    for (let i = 0; i < 22; i++) {
      const cactus = buildCactus(rand(1.5, 3.8)),
        x = (i % 2 ? 1 : -1) * rand(8, 42),
        z = rand(-170, 45);
      cactus.position.set(x, Math.max(0, terrainHeight(x, z + 240)), z);
      cactus.rotation.y = rand(0, 6);
      this.scene.add(cactus);
      this.plants.push(cactus);
    }
    const blade = new THREE.ConeGeometry(0.035, 1, 3);
    blade.translate(0, 0.5, 0);
    const grass = new THREE.InstancedMesh(
      blade,
      new THREE.MeshStandardMaterial({ color: "#8f8557", roughness: 1 }),
      1500,
    );
    for (let i = 0; i < 1500; i++) {
      const cluster = Math.floor(i / 6);
      let seed = cluster * 172.73;
      const x =
          (cluster % 2 ? 1 : -1) * (7 + (Math.sin(seed) * 0.5 + 0.5) * 40),
        z = -180 + (Math.sin(seed * 1.72) * 0.5 + 0.5) * 235;
      temp.position.set(
        x + rand(-0.3, 0.3),
        Math.max(0, terrainHeight(x, z + 240)) - 0.04,
        z + rand(-0.3, 0.3),
      );
      temp.rotation.set(rand(-0.5, 0.5), rand(0, 6.2), rand(-0.5, 0.5));
      temp.scale.set(1, rand(0.15, 0.7), 1);
      temp.updateMatrix();
      grass.setMatrixAt(i, temp.matrix);
    }
    this.scene.add(grass);
    this.grass = grass;
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
  update(dt, time, speed = 0) {
    this.distance += speed * dt;
    this.sand.offset.y = (-this.distance / 950) * 90;
    this.roadTexture.offset.y = (-this.distance / 700) * 35;
    this.plants.forEach((p) => {
      p.position.z += speed * dt;
      if (p.position.z > 55) {
        p.position.z -= 235;
        p.position.y = Math.max(
          0,
          terrainHeight(p.position.x, p.position.z + 240),
        );
      }
    });
    this.rocks.position.z = this.distance % 100;
    this.grass.position.z = this.distance % 80;
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
