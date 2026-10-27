import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { contactShadowTexture } from "./surface-detail.js";
import { ScrollingScenery } from "./scrolling-scenery.js";
import { ROCK_FORMS, BOULDER_FORMS, rockFormationGeometry, boulderGeometry } from "./rock-formations.js";
import { createSkyMaterial } from "./sky-material.js";

const groundColorURL = new URL("./assets/ground-color.webp", import.meta.url).href;
const groundNormalURL = new URL("./assets/ground-normal.webp", import.meta.url).href;
const rockColorURL = new URL("./assets/rock-color.webp", import.meta.url).href;
const rockNormalURL = new URL("./assets/rock-normal.webp", import.meta.url).href;
const rand = (a, b) => a + Math.random() * (b - a);
const temp = new THREE.Object3D();
const color = new THREE.Color();

export function terrainHeight(x, z) {
  const edge = THREE.MathUtils.smoothstep(Math.abs(x), 4.5, 25);
  const distant = THREE.MathUtils.smoothstep(Math.abs(x), 35, 100);
  return edge * (0.32 + Math.sin(x * 0.22) * 0.14 + Math.cos(x * 0.5) * 0.12) +
    distant * (2.8 + Math.sin(x * 0.065 + z * 0.014) * 1.8 + Math.cos(z * 0.023) * 1.2) - 0.04;
}

function loadMaps(world, material, colorURL, normalURL, repeat) {
  const loader = new THREE.TextureLoader();
  const task = Promise.all([loader.loadAsync(colorURL), loader.loadAsync(normalURL)]).then(([map, normal]) => {
    // A slow first visit can reach the loading-screen deadline before these
    // arrive. Keep the already visible fallback for this visit instead of
    // changing the terrain's palette and UV scale in the middle of a run.
    if (world.surfacesFinalized) {
      map.dispose();
      normal.dispose();
      return;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [map, normal]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(...repeat);
      texture.anisotropy = 4;
    }
    material.map = map;
    material.normalMap = normal;
    material.needsUpdate = true;
    if (colorURL === groundColorURL) { world.sand = map; world.groundNormal = normal; }
  }).catch((error) => console.warn("Using the local procedural surface fallback.", error));
  world.surfaceTasks ??= [];
  world.surfaceTasks.push(task);
}

function rockMaterial(world) {
  if (!world.strataMaterial) {
    world.strataMaterial = new THREE.MeshStandardMaterial({ color: "#d7b094", roughness: 0.95, vertexColors: true, normalScale: new THREE.Vector2(0.65, 0.65) });
    loadMaps(world, world.strataMaterial, rockColorURL, rockNormalURL, [2, 2]);
  }
  return world.strataMaterial;
}

export function enhanceGround(world, ground) {
  ground.material.color.set("#e0c29d");
  ground.material.vertexColors = true;
  ground.material.normalScale = new THREE.Vector2(0.8, 0.8);
  const position = ground.geometry.attributes.position, colors = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const value = 0.86 + 0.1 * Math.sin(x * 0.017 + z * 0.025) * Math.cos(z * 0.031);
    colors.push(value, value * 0.98, value * 0.94);
  }
  ground.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  loadMaps(world, ground.material, groundColorURL, groundNormalURL, [650 / 7, 950 / 7]);
  world.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 5.5), new THREE.MeshBasicMaterial({
    map: contactShadowTexture(), transparent: true, opacity: 0.4, depthWrite: false,
  }));
  world.contactShadow.rotation.x = -Math.PI / 2;
  world.contactShadow.position.set(0, 0.021, 0.25);
  world.scene.add(world.contactShadow);
}

export function createAtmosphere(world, renderer) {
  const skyMaterial = createSkyMaterial();
  world.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial);
  world.sky.scale.setScalar(700);
  world.scene.add(world.sky);
  const environment = new THREE.Scene();
  const reflectedSky = new THREE.Mesh(world.sky.geometry, skyMaterial);
  reflectedSky.scale.setScalar(500);
  environment.add(reflectedSky);
  const generator = new THREE.PMREMGenerator(renderer);
  world.environmentTarget = generator.fromScene(environment, 0, 0.1, 1000, { size: 128 });
  world.scene.environment = world.environmentTarget.texture;
  world.scene.environmentIntensity = 0.4;
  generator.dispose();
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 160; i++) {
    const x = rand(-80, 1100), y = rand(75, 180), width = rand(35, 170);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, width);
    gradient.addColorStop(0, "#fff3da18"); gradient.addColorStop(1, "#fff4dc00");
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.16); ctx.translate(-x, -y);
    ctx.fillStyle = gradient; ctx.fillRect(x - width, y - width, width * 2, width * 2); ctx.restore();
  }
  world.cloudTexture = new THREE.CanvasTexture(canvas);
  world.cloudTexture.colorSpace = THREE.SRGBColorSpace;
  world.cloudTexture.wrapS = THREE.RepeatWrapping;
  world.cloudMaterial = new THREE.MeshBasicMaterial({
    map: world.cloudTexture, transparent: true, opacity: 0.65, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), world.cloudMaterial);
  world.scene.add(clouds);
}

export function createBadlands(world) {
  const material = rockMaterial(world);
  const tile = new THREE.Group();
  world.ridgeMaterials = [];
  // These ridges are world geometry, rather than a horizon cylinder attached
  // to the camera. Matching endpoints let the distant ridge tiles join up.
  for (let layer = 0; layer < 2; layer++) {
    const ridgeMaterial = new THREE.MeshBasicMaterial({ color: layer ? "#c2c5bd" : "#a4b0ad", side: THREE.DoubleSide });
    world.ridgeMaterials.push(ridgeMaterial);
    for (const side of [-1, 1]) {
      const positions = [], indices = [];
      for (let i = 0; i <= 100; i++) {
        const t = i / 100, angle = t * Math.PI * 2;
        const x = side * (345 + layer * 65 + Math.sin(angle * 3) * 12);
        const top = 24 + Math.sin(angle * 2 + layer) * 12 + Math.sin(angle * 7) * 4;
        positions.push(x, -4, -420 + t * 420, x, top, -420 + t * 420);
        if (i < 100) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      tile.add(new THREE.Mesh(geometry, ridgeMaterial));
    }
  }
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1;
    const kind = ROCK_FORMS[i % ROCK_FORMS.length];
    const mesa = new THREE.Mesh(rockFormationGeometry(kind, rand(25, 46),
      kind === "dome" ? rand(12, 23) : rand(20, 43), i + 1), material);
    mesa.position.set(side * (45 + Math.floor(i / 2) * 17), -0.5, -65 - Math.floor(i / 2) * 35);
    mesa.scale.z = rand(0.65, 1.2);
    mesa.rotation.y = rand(0, 6.3);
    mesa.receiveShadow = true;
    tile.add(mesa);
  }
  // Fill the middle distance with low outcrops, thin fins, split buttes and
  // tapered pillars. Every formation has a solid base; no stone rings.
  const sizes = { mesa: [10, 6], butte: [6, 12], spire: [3, 15], fin: [6, 11], dome: [9, 5], cluster: [7, 10] };
  for (let i = 0; i < 18; i++) {
    const kind = ROCK_FORMS[(i + 2) % ROCK_FORMS.length], [width, height] = sizes[kind];
    const formation = new THREE.Mesh(rockFormationGeometry(kind, width * rand(0.75, 1.25), height * rand(0.7, 1.3), i + 30), material);
    const x = (i % 2 ? 1 : -1) * rand(15, 40), z = -190 + i * 12 + rand(-5, 5);
    formation.position.set(x, -0.4, z);
    formation.rotation.y = rand(0, Math.PI * 2);
    formation.castShadow = formation.receiveShadow = true;
    tile.add(formation);
  }
  world.badlands = new ScrollingScenery(tile);
  world.scene.add(world.badlands);
}

function bladeGeometry(width, height, bend, sections = 5) {
  const points = [], uvs = [], indices = [];
  for (let i = 0; i <= sections; i++) {
    const t = i / sections, w = width * Math.sin(Math.PI * (0.07 + t * 0.92));
    points.push(-w, t * height, t * t * bend, w, t * height, t * t * bend);
    uvs.push(0, t, 1, t);
    if (i < sections) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createVegetation(world, buildCactus) {
  world.plants = [];
  for (let i = 0; i < 26; i++) {
    const cactus = buildCactus(rand(1.4, 3.8));
    const x = (i % 2 ? 1 : -1) * rand(5.5, 36), z = rand(-205, 50);
    cactus.position.set(x, world.groundHeightAt(x, z), z);
    cactus.rotation.y = rand(0, 6.3);
    world.scene.add(cactus); world.plants.push(cactus);
  }
  const group = new THREE.Group();
  const grassMaterial = new THREE.MeshStandardMaterial({ color: "#ae9c64", roughness: 1, side: THREE.DoubleSide });
  const wind = { value: 0 };
  grassMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = "uniform float uWindTime;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "vec3 transformed = vec3(position); transformed.x += sin(uWindTime*1.4 + instanceMatrix[3].x*.4 + instanceMatrix[3].z*.2)*position.y*position.y*.13;");
  };
  world.windUniform = wind;
  const grass = new THREE.InstancedMesh(bladeGeometry(0.035, 1, 0.25, 3), grassMaterial, 4200);
  for (let i = 0; i < 4200; i++) {
    const cluster = Math.floor(i / 10), seed = cluster * 172.73;
    const x = (cluster % 2 ? 1 : -1) * (4.2 + (Math.sin(seed) * 0.5 + 0.5) * 34);
    const z = -220 + (Math.sin(seed * 1.72) * 0.5 + 0.5) * 260;
    temp.position.set(x + rand(-0.4, 0.4), terrainHeight(x, 0), z + rand(-0.4, 0.4));
    temp.rotation.set(rand(-0.15, 0.15), rand(0, 6.3), rand(-0.3, 0.3));
    temp.scale.set(1, rand(0.22, 0.8), 1); temp.updateMatrix(); grass.setMatrixAt(i, temp.matrix);
    grass.setColorAt(i, color.setHSL(rand(0.12, 0.18), rand(0.12, 0.25), rand(0.4, 0.7)));
  }
  group.add(grass); world.grassBlades = grass;
  const agave = new THREE.InstancedMesh(bladeGeometry(0.1, 0.85, 0.6), new THREE.MeshStandardMaterial({ color: "#617b69", roughness: 0.82, side: THREE.DoubleSide }), 660);
  for (let i = 0; i < 660; i++) {
    const cluster = Math.floor(i / 11), angle = (i % 11) / 11 * Math.PI * 2;
    const x = (cluster % 2 ? 1 : -1) * (4.5 + (Math.sin(cluster * 77.13) * 0.5 + 0.5) * 29);
    const z = -220 + (Math.sin(cluster * 89.3) * 0.5 + 0.5) * 260;
    temp.position.set(x, terrainHeight(x, 0), z);
    temp.rotation.set(rand(-0.18, 0.18), angle, 0);
    temp.scale.setScalar(rand(0.65, 1.15)); temp.updateMatrix(); agave.setMatrixAt(i, temp.matrix);
    agave.setColorAt(i, color.setHSL(rand(0.23, 0.32), 0.12, rand(0.32, 0.52)));
  }
  group.add(agave);
  const leafGeometry = new THREE.BufferGeometry();
  leafGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1,0,0, -.4,.2,-.8, .4,.2,-.8, 1,0,0, .4,.2,.8, -.4,.2,.8, 0,.35,0,
  ], 3));
  leafGeometry.setIndex([6,0,1,6,1,2,6,2,3,6,3,4,6,4,5,6,5,0]);
  leafGeometry.computeVertexNormals();
  const leaves = new THREE.InstancedMesh(leafGeometry, new THREE.MeshStandardMaterial({ color: "#72816b", roughness: 1, side: THREE.DoubleSide }), 1680);
  const stems = [];
  for (let i = 0; i < 1680; i++) {
    const cluster = Math.floor(i / 14), a = i * 2.399;
    const x = (cluster % 2 ? 1 : -1) * (5 + (Math.sin(cluster * 39.2) * 0.5 + 0.5) * 27);
    const z = -220 + (Math.cos(cluster * 58.3) * 0.5 + 0.5) * 260;
    const radius = rand(0.05, 0.55);
    temp.position.set(x + Math.cos(a) * radius, terrainHeight(x, 0) + rand(0.15, 0.65), z + Math.sin(a) * radius);
    stems.push(x, terrainHeight(x, 0) + 0.03, z, temp.position.x, temp.position.y, temp.position.z);
    temp.rotation.set(rand(0, 3), a, rand(0, 3)); temp.scale.set(0.13, 0.04, 0.23); temp.updateMatrix(); leaves.setMatrixAt(i, temp.matrix);
    leaves.setColorAt(i, color.setHSL(rand(0.13, 0.27), rand(0.05, 0.2), rand(0.32, 0.55)));
  }
  group.add(leaves);
  const stemGeometry = new THREE.BufferGeometry();
  stemGeometry.setAttribute("position", new THREE.Float32BufferAttribute(stems, 3));
  world.stemMaterial = new THREE.LineBasicMaterial({ color: "#736c49" });
  group.add(new THREE.LineSegments(stemGeometry, world.stemMaterial));
  const treeParts = [];
  for (const [a, b, radius] of [
    [[0, 0, 0], [0.13, 1.6, 0], 0.11], [[0.13, 1.3, 0], [-0.65, 2.1, 0.1], 0.065],
    [[0.1, 1.0, 0], [0.7, 1.9, -0.15], 0.07], [[0.7, 1.9, -0.15], [1, 2.2, 0.05], 0.025],
    [[-0.4, 1.8, 0.05], [-0.9, 2.35, -0.1], 0.025], [[0.1, 1.2, 0], [0.1, 1.9, 0.6], 0.045],
  ]) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const geometry = new THREE.CylinderGeometry(radius * 0.3, radius, from.distanceTo(to), 7);
    const transform = new THREE.Object3D(); transform.position.copy(from).add(to).multiplyScalar(0.5);
    transform.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize()); transform.updateMatrix();
    geometry.applyMatrix4(transform.matrix); treeParts.push(geometry);
  }
  const trees = new THREE.InstancedMesh(mergeGeometries(treeParts), new THREE.MeshStandardMaterial({ color: "#71604c", roughness: 1 }), 20);
  treeParts.forEach((geometry) => geometry.dispose());
  for (let i = 0; i < 20; i++) {
    const x = (i % 2 ? 1 : -1) * rand(7, 40);
    temp.position.set(x, terrainHeight(x, 0), rand(-215, 35)); temp.rotation.set(0, rand(0, 6.3), rand(-0.15, 0.15));
    temp.scale.setScalar(rand(0.5, 1.5)); temp.updateMatrix(); trees.setMatrixAt(i, temp.matrix);
  }
  trees.castShadow = true; group.add(trees);
  world.grass = group; world.scene.add(group);
  world.grassTwin = group.clone(); world.grassTwin.position.z = -260; world.scene.add(world.grassTwin);
}

export function createRockField(world) {
  const material = rockMaterial(world);
  const rocks = new THREE.Group(), bounds = new THREE.Box3();
  const vertex = new THREE.Vector3(), lowest = new THREE.Vector3();
  for (const [type, kind] of BOULDER_FORMS.entries()) {
    const geometry = boulderGeometry(kind, type + 7);
    const batch = new THREE.InstancedMesh(geometry, material, 48);
    for (let i = 0; i < 48; i++) {
      const s = i % 9 === 0 ? rand(1.1, 2.3) : rand(0.08, 0.9);
      const x = (i % 2 ? 1 : -1) * rand(5.5 + s * 2.2, 30), z = rand(-220, 40);
      temp.position.set(0, 0, 0);
      temp.rotation.set(rand(-0.12, 0.12), rand(0, Math.PI * 2), rand(-0.12, 0.12));
      temp.scale.set(s * rand(0.85, 1.2), s, s); temp.updateMatrix();
      bounds.copy(geometry.boundingBox).applyMatrix4(temp.matrix);
      // A rotated bounding box can extend below a rounded rock's real mesh.
      // Use the actual lowest vertex so every rock meets the terrain.
      lowest.set(0, Infinity, 0);
      const positions = geometry.attributes.position;
      for (let v = 0; v < positions.count; v++) {
        vertex.fromBufferAttribute(positions, v).applyMatrix4(temp.matrix);
        if (vertex.y < lowest.y) lowest.copy(vertex);
      }
      const ground = Math.min(world.groundHeightAt(x + lowest.x, z + lowest.z), ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) =>
        world.groundHeightAt(x + (a < 0 ? bounds.min.x : bounds.max.x), z + (b < 0 ? bounds.min.z : bounds.max.z))));
      temp.position.set(x, ground - lowest.y - s * 0.045, z);
      temp.updateMatrix(); batch.setMatrixAt(i, temp.matrix);
      batch.setColorAt(i, color.setHSL(rand(0.055, 0.09), rand(0.08, 0.18), rand(0.68, 0.86)));
    }
    batch.castShadow = batch.receiveShadow = true;
    rocks.add(batch);
  }
  world.scene.add(rocks); world.rocks = rocks;
  world.rocksTwin = rocks.clone(); world.rocksTwin.position.z = -260; world.scene.add(world.rocksTwin);
}

export function updateLandscape(world, time, mountHeight) {
  world.badlands.update(world.distance);
  world.grass.position.z = world.distance % 260;
  world.grassTwin.position.z = world.grass.position.z - 260;
  world.rocks.position.z = world.distance % 260;
  world.rocksTwin.position.z = world.rocks.position.z - 260;
  world.windUniform.value = time;
  world.cloudTexture.offset.x = time * 0.0007;
  if (world.groundNormal) world.groundNormal.offset.copy(world.sand.offset);
  world.contactShadow.scale.setScalar(1 + mountHeight * 0.12);
  world.contactShadow.material.opacity = (world.quality === "high" ? 0.23 : 0.42) / (1 + mountHeight * 0.4);
}
