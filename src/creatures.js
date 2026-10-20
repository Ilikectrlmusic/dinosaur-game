import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeStaticMeshes, loftGeometry, curveMesh } from "./model-detail.js";
import { reptileSurface, fabricSurface, leatherSurface } from "./surface-detail.js";
import { FlexibleRein } from "./flexible-rein.js";
import { mountDefinition } from "./mounts.js";
import { DinosaurGait, solveLeg } from "./dinosaur-gait.js";

const saddleAnchor = new THREE.Vector3(0, 2.61, 0.15);

// Cache the real sole's support height at each ankle angle. Rolling onto the
// heel or toes must not push the mesh through the ground or make it hover.
function footSupportProfile(foot) {
  const points = [], point = new THREE.Vector3();
  for (const mesh of foot.children) {
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix);
      points.push([point.y, point.z]);
    }
  }
  return Float32Array.from({ length: 161 }, (_, i) => {
    const angle = -0.8 + i * 0.01, c = Math.cos(angle), s = Math.sin(angle);
    let lowest = Infinity;
    for (const [y, z] of points) lowest = Math.min(lowest, y * c - z * s);
    return 0.003 - lowest;
  });
}

function supportHeight(profile, pitch) {
  const index = THREE.MathUtils.clamp((pitch + 0.8) / 0.01, 0, profile.length - 1);
  const low = Math.floor(index);
  return THREE.MathUtils.lerp(profile[low], profile[Math.min(low + 1, profile.length - 1)], index - low);
}

const sphere = new THREE.SphereGeometry(1, 24, 16);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);
const cone = new THREE.ConeGeometry(1, 1, 10);
const fabric = fabricSurface(), leatherGrain = leatherSurface();
export const RIDERS = [
  {
    name: "艾拉",
    coat: "#c17d42",
    skin: "#bf8c66",
    pants: "#4b5344",
    hat: "#ab9771",
    scarf: "#d3bc86",
    hair: "#352c25",
  },
  {
    name: "凯",
    coat: "#4c6867",
    skin: "#9d7151",
    pants: "#343f3c",
    hat: "#48554b",
    scarf: "#aa6845",
    hair: "#211f1b",
  },
  {
    name: "诺瓦",
    coat: "#985b4e",
    skin: "#d2a17f",
    pants: "#514b47",
    hat: "#7d705c",
    scarf: "#859992",
    hair: "#4c3426",
  },
];
const leather = new THREE.MeshStandardMaterial({
  ...leatherGrain,
  color: "#4a3021",
  roughness: 0.9,
});
const darkLeather = new THREE.MeshStandardMaterial({
  ...leatherGrain,
  color: "#2f2a20",
  roughness: 0.95,
});
const bone = new THREE.MeshStandardMaterial({
  color: "#dfd0a0",
  roughness: 0.6,
});
const steel = new THREE.MeshStandardMaterial({
  color: "#aba38c",
  roughness: 0.4,
  metalness: 0.7,
});
export function ellipsoid(parent, mat, position, scale, rotation) {
  const mesh = new THREE.Mesh(sphere, mat);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function segment(parent, mat, from, to, radius, endRadius = radius) {
  const a = new THREE.Vector3(...from),
    b = new THREE.Vector3(...to);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(endRadius, radius, a.distanceTo(b), 14),
    mat,
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.sub(a).normalize(),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function ring(parent, material, radius, tube, pos, rotation) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 6, 32),
    material,
  );
  mesh.position.set(...pos);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}
const reptile = reptileSurface();
const skin = new THREE.MeshStandardMaterial({
  ...reptile,
  color: "#ccd0ad",
  normalScale: new THREE.Vector2(0.4, 0.4),
  vertexColors: true,
});
const belly = new THREE.MeshStandardMaterial({
  ...reptile,
  color: "#e2ca95",
  normalScale: new THREE.Vector2(0.3, 0.3),
  roughness: 0.88,
});
const horn = new THREE.MeshStandardMaterial({
  color: "#77795b",
  roughness: 0.9,
});
const stitch = new THREE.MeshStandardMaterial({ color: "#d0b58a", roughness: 1 });

function roundedPart(parent, material, size, position, radius = 0.04) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, radius), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function anatomicalPart(parent, sections, material = skin, offset = 0) {
  const geometry = loftGeometry(sections, 28);
  if (material.vertexColors) {
    const positions = geometry.attributes.position, colors = [];
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i), z = positions.getZ(i) + offset;
      const stripe = Math.max(0, Math.sin(z * 11 + y * 3) - 0.35) * Math.max(0, y + 0.45);
      color.setRGB(0.88 - stripe * 0.28, 0.93 - stripe * 0.25, 0.77 - stripe * 0.22);
      if (y < -0.2) color.lerp(new THREE.Color("#dfc79c"), Math.min(0.65, -y));
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function buildRider(index = 0) {
  const config = RIDERS[index],
    root = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({
    ...fabric,
    color: config.coat,
    roughness: 1,
  });
  const cloth = new THREE.MeshStandardMaterial({
    ...fabric,
    color: config.pants,
    roughness: 1,
  });
  const face = new THREE.MeshStandardMaterial({
    color: config.skin,
    roughness: 0.85,
  });
  const hat = new THREE.MeshStandardMaterial({
    ...fabric,
    color: config.hat,
    roughness: 1,
  });
  const scarfMat = new THREE.MeshStandardMaterial({
    ...fabric,
    color: config.scarf,
    roughness: 1,
  });
  const hair = new THREE.MeshStandardMaterial({
    color: config.hair,
    roughness: 1,
  });
  const pelvis = new THREE.Group();
  pelvis.position.set(0, 2.94, 0.12);
  root.add(pelvis);
  ellipsoid(pelvis, cloth, [0, 0, 0], [0.3, 0.22, 0.23]);
  const torso = new THREE.Group();
  torso.position.set(0, 3.39, 0.02);
  root.add(torso);
  const jacket = new THREE.Mesh(loftGeometry([
    [-0.42, 0, 0.2, 0.16], [-0.32, 0, 0.25, 0.18], [-0.08, 0, 0.28, 0.205],
    [0.21, 0, 0.33, 0.22], [0.34, 0, 0.29, 0.19], [0.42, 0, 0.13, 0.12],
  ]).rotateX(-Math.PI / 2), coat);
  jacket.castShadow = true;
  torso.add(jacket);
  // Stitched expedition vest, belt, chest pockets and straps.
  for (const s of [-1, 1]) {
    ellipsoid(torso, leather, [s * 0.175, 0.04, -0.192], [0.085, 0.105, 0.025]);
    segment(
      torso,
      darkLeather,
      [s * 0.22, 0.33, -0.19],
      [s * 0.18, -0.32, -0.21],
      0.022,
    );
    ellipsoid(torso, steel, [s * 0.18, -0.12, -0.226], [0.025, 0.018, 0.011]);
  }
  ring(
    torso,
    darkLeather,
    0.245,
    0.025,
    [0, -0.31, 0],
    [Math.PI / 2, 0, 0],
  ).scale.set(1.1, 0.8, 1);
  ellipsoid(torso, steel, [0, -0.32, -0.23], [0.045, 0.035, 0.012]);
  const packMat = new THREE.MeshStandardMaterial({ ...fabric, color: index === 0 ? "#967246" : index === 1 ? "#4d5c4a" : "#7a5147" });
  const backpack = roundedPart(torso, packMat, [0.45, 0.57, 0.25], [0, 0.015, 0.3], 0.07);
  backpack.userData.keepSeparate = true;
  roundedPart(torso, leather, [0.39, 0.17, 0.06], [0, 0.19, 0.445]);
  roundedPart(torso, packMat, [0.29, 0.2, 0.07], [0, -0.13, 0.45]);
  for (const s of [-1, 1]) {
    segment(torso, darkLeather, [s * 0.15, 0.31, 0.43], [s * 0.15, -0.25, 0.46], 0.018);
    roundedPart(torso, steel, [0.048, 0.065, 0.013], [s * 0.15, 0.03, 0.472], 0.009);
    torso.add(curveMesh([[s * 0.22, 0.29, -0.18], [s * 0.3, 0.36, 0.05], [s * 0.2, 0.26, 0.39]], 0.026, darkLeather));
    torso.add(curveMesh([[s * 0.065, 0.27, -0.22], [s * 0.09, 0.08, -0.235], [s * 0.11, -0.29, -0.185]], 0.004, stitch));
    roundedPart(torso, leather, [0.13, 0.17, 0.035], [s * 0.18, 0.035, -0.215], 0.02);
    for (let j = 0; j < 4; j++) segment(torso, stitch, [s * 0.18 - 0.04 + j * 0.026, 0.09, -0.238], [s * 0.18 - 0.025 + j * 0.026, 0.09, -0.238], 0.003);
  }
  segment(torso, scarfMat, [-0.27, 0.37, 0.35], [0.27, 0.37, 0.35], 0.09);
  for (const x of [-0.19, 0.19]) ring(torso, darkLeather, 0.092, 0.014, [x, 0.37, 0.35], [0, Math.PI / 2, 0]);
  ellipsoid(torso, steel, [0.26, -0.12, 0.31], [0.08, 0.13, 0.065]);
  segment(torso, leather, [0.26, -0.01, 0.31], [0.26, 0.02, 0.31], 0.035);
  segment(torso, scarfMat, [-0.19, 0.27, 0.39], [0.19, 0.27, 0.39], 0.065);
  ellipsoid(torso, scarfMat, [0, 0.39, -0.015], [0.18, 0.11, 0.16]);
  ellipsoid(
    torso,
    scarfMat,
    [0.08, 0.22, -0.22],
    [0.075, 0.22, 0.025],
    [0, 0, -0.25],
  );
  const head = new THREE.Group();
  head.position.set(0, 3.99, -0.05);
  root.add(head);
  ellipsoid(head, face, [0, 0, 0], [0.205, 0.26, 0.2]);
  ellipsoid(head, face, [0, -0.12, -0.12], [0.14, 0.12, 0.115]);
  ellipsoid(head, face, [0, -0.035, -0.204], [0.038, 0.055, 0.05]);
  const lip = new THREE.MeshStandardMaterial({ color: "#8f5945", roughness: 0.75 });
  head.add(curveMesh([[-0.065, -0.125, -0.198], [0, -0.136, -0.221], [0.06, -0.125, -0.198]], 0.007, lip, 8));
  for (const s of [-1, 1]) {
    ellipsoid(head, face, [s * 0.202, -0.015, 0], [0.038, 0.065, 0.045]);
    ellipsoid(head, hair, [s * 0.087, 0.04, -0.18], [0.041, 0.012, 0.013]);
    ellipsoid(
      head,
      bone,
      [s * 0.087, 0.015, -0.193],
      [0.032, 0.017, 0.012],
    );
    ellipsoid(head, darkLeather, [s * 0.084, 0.014, -0.204], [0.01, 0.013, 0.005]);
    ellipsoid(head, bone, [s * 0.08, 0.019, -0.21], [0.003, 0.004, 0.003]);
  }
  ellipsoid(head, hair, [0, 0.13, 0.025], [0.21, 0.17, 0.19]);
  if (index === 0) {
    for (const s of [-1, 1])
      for (let j = 0; j < 4; j++)
        ellipsoid(
          head,
          hair,
          [s * 0.19, -0.13 - j * 0.065, 0.09],
          [0.05, 0.055, 0.055],
        );
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.035, 32),
      hat,
    );
    brim.position.y = 0.2;
    brim.scale.z = 0.82;
    const brimPos = brim.geometry.attributes.position;
    for (let i = 0; i < brimPos.count; i++) brimPos.setY(i, brimPos.getY(i) + Math.abs(brimPos.getX(i)) ** 2 * 0.3);
    brim.geometry.computeVertexNormals();
    head.add(brim);
    brim.castShadow = true;
    ellipsoid(head, hat, [0, 0.27, 0.02], [0.225, 0.15, 0.2]);
    ring(
      head,
      leather,
      0.218,
      0.018,
      [0, 0.25, 0.015],
      [Math.PI / 2, 0, 0],
    ).scale.y = 0.88;
  } else if (index === 1) {
    ellipsoid(head, hat, [0, 0.2, 0.03], [0.23, 0.17, 0.22]);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.025, 0.21), hat);
    brim.position.set(0, 0.2, -0.22);
    head.add(brim);
    ellipsoid(head, hair, [0, -0.13, -0.08], [0.17, 0.1, 0.16]);
    roundedPart(head, leather, [0.11, 0.065, 0.018], [0, 0.27, -0.181], 0.014);
    for (const s of [-1, 1]) {
      segment(torso, darkLeather, [s * 0.07, 0.08, -0.24], [s * 0.07, -0.07, -0.28], 0.035);
      ellipsoid(torso, steel, [s * 0.07, -0.065, -0.29], [0.04, 0.018, 0.04]);
    }
  } else {
    ellipsoid(head, scarfMat, [0, 0.21, 0.025], [0.23, 0.14, 0.23]);
    ring(head, leather, 0.214, 0.025, [0, 0.17, 0.015], [Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) {
      ellipsoid(
        head,
        darkLeather,
        [s * 0.105, 0.17, -0.2],
        [0.083, 0.06, 0.045],
      );
      ellipsoid(head, new THREE.MeshStandardMaterial({ color: "#b77c3e", metalness: 0.45, roughness: 0.19 }), [s * 0.105, 0.17, -0.24], [0.065, 0.043, 0.01]);
    }
    for (let j = 0; j < 5; j++)
      ellipsoid(head, hair, [0.2, -0.1 - j * 0.06, 0.12], [0.05, 0.05, 0.05]);
  }
  const limbs = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.29, 3.65, -0.015);
    root.add(arm);
    segment(arm, coat, [0, 0, 0], [s * 0.1, -0.31, -0.14], 0.1, 0.085);
    ellipsoid(arm, coat, [s * 0.1, -0.31, -0.14], [0.1, 0.1, 0.1]);
    segment(
      arm,
      coat,
      [s * 0.1, -0.31, -0.14],
      [s * 0.05, -0.48, -0.44],
      0.085,
      0.065,
    );
    ellipsoid(arm, darkLeather, [s * 0.05, -0.48, -0.44], [0.075, 0.075, 0.09]);
    const hand = new THREE.Object3D();
    hand.position.set(s * 0.05, -0.505, -0.485);
    arm.add(hand);
    for (let finger = 0; finger < 4; finger++) segment(arm, face, [s * 0.05 + (finger - 1.5) * 0.025, -0.49, -0.48], [s * 0.05 + (finger - 1.5) * 0.025, -0.535, -0.51], 0.012);
    arm.add(curveMesh([[s * 0.07, -0.14, -0.13], [s * 0.14, -0.3, -0.16], [s * 0.075, -0.43, -0.39]], 0.004, stitch, 8));
    const leg = new THREE.Group();
    leg.position.set(s * 0.28, 2.94, 0.12);
    root.add(leg);
    segment(leg, cloth, [0, 0, 0], [s * 0.28, -0.45, -0.21], 0.145, 0.11);
    ellipsoid(leg, cloth, [s * 0.28, -0.45, -0.21], [0.12, 0.13, 0.12]);
    segment(
      leg,
      cloth,
      [s * 0.28, -0.45, -0.21],
      [s * 0.34, -0.91, 0.02],
      0.1,
      0.08,
    );
    ellipsoid(
      leg,
      darkLeather,
      [s * 0.34, -0.89, -0.055],
      [0.105, 0.19, 0.16],
      [0.12, 0, 0],
    );
    ring(
      leg,
      steel,
      0.1,
      0.012,
      [s * 0.34, -1.01, -0.04],
      [0, Math.PI / 2, 0],
    ).scale.y = 1.3;
    roundedPart(leg, leather, [0.14, 0.15, 0.035], [s * 0.28, -0.43, -0.318], 0.025);
    for (let j = 0; j < 4; j++) segment(leg, stitch, [s * 0.34 - 0.035, -0.78 - j * 0.04, -0.19], [s * 0.34 + 0.035, -0.795 - j * 0.04, -0.19], 0.005);
    limbs.push({ arm, hand, leg, side: s });
  }
  // Bend the upper body around the hips, leaving the seat and stirrups planted.
  const upperBody = new THREE.Group();
  upperBody.position.copy(pelvis.position);
  root.add(upperBody);
  upperBody.attach(torso);
  upperBody.attach(head);
  limbs.forEach(({ arm }) => upperBody.attach(arm));
  mergeStaticMeshes(root);
  return { root, upperBody, torso, head, pelvis, limbs, backpack, index };
}

function mountMaterials(definition) {
  const materials = { skin: skin.clone(), belly: belly.clone(), horn: horn.clone() };
  for (const [name, material] of Object.entries(materials)) material.color.set(definition[name]);
  if (definition.id !== "allosaurus") {
    // Reuse the scale markings as luminance so the original green pigment
    // does not tint the red and blue species or erase their surface detail.
    for (const material of [materials.skin, materials.belly]) {
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", THREE.ShaderChunk.map_fragment.replace(
          "diffuseColor *= sampledDiffuseColor;",
          "sampledDiffuseColor.rgb = vec3(dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))) * 1.7; diffuseColor *= sampledDiffuseColor;",
        ));
      };
      material.customProgramCacheKey = () => "saurian-pigment-v1";
    }
  }
  return materials;
}

function addMountFeatures(definition, body, head, hornMaterial) {
  if (definition.id === "carnotaurus") {
    for (const side of [-1, 1]) {
      ellipsoid(head, hornMaterial, [side * 0.33, 0.31, -0.22], [0.16, 0.11, 0.18]);
      segment(head, hornMaterial, [side * 0.34, 0.31, -0.23], [side * 0.51, 0.48, -0.18], 0.135, 0.08);
      segment(head, hornMaterial, [side * 0.51, 0.48, -0.18], [side * 0.69, 0.59, -0.1], 0.08, 0.003);
    }
    const armor = new THREE.MeshStandardMaterial({ color: "#6f4938", roughness: 0.96 });
    for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
      const z = -0.85 + i * 0.28;
      const x = side * (0.58 - Math.abs(z) * 0.14);
      ellipsoid(body, armor, [x, 0.27, z], [0.075, 0.09, 0.095]);
      ellipsoid(body, armor, [x * 1.06, -0.02, z + 0.12], [0.06, 0.07, 0.085]);
    }
  } else if (definition.id === "dilophosaurus") {
    const crests = new THREE.Group();
    crests.scale.y = 0.75;
    head.add(crests);
    const shape = new THREE.Shape();
    shape.moveTo(-1.15, 0.12);
    shape.bezierCurveTo(-1.14, 0.4, -0.93, 0.77, -0.63, 0.87);
    shape.bezierCurveTo(-0.37, 0.96, -0.12, 0.65, 0.13, 0.22);
    shape.bezierCurveTo(-0.3, 0.33, -0.75, 0.3, -1.15, 0.12);
    const crestMaterial = new THREE.MeshStandardMaterial({ ...reptile, map: null, color: "#bd7950", roughness: 0.84 });
    const rimMaterial = new THREE.MeshStandardMaterial({ color: "#e3b978", roughness: 0.9 });
    for (const side of [-1, 1]) {
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.018, bevelThickness: 0.012, curveSegments: 16 });
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const z = positions.getX(i), y = positions.getY(i), x = positions.getZ(i);
        positions.setXYZ(i, side * 0.2 - x + 0.0225, y, z);
      }
      geometry.computeVertexNormals();
      const crest = new THREE.Mesh(geometry, crestMaterial);
      crest.castShadow = crest.receiveShadow = true;
      crests.add(crest);
      crests.add(curveMesh([[side * 0.2, 0.18, -1.14], [side * 0.2, 0.62, -0.95], [side * 0.2, 0.87, -0.63], [side * 0.2, 0.68, -0.24], [side * 0.2, 0.24, 0.1]], 0.018, rimMaterial, 24));
      for (let i = 0; i < 4; i++) {
        const z = -0.97 + i * 0.22;
        crests.add(curveMesh([[side * 0.238, 0.23, z], [side * 0.238, 0.39, z + 0.01], [side * 0.238, 0.5 + Math.sin((i + 1) / 5 * Math.PI) * 0.25, z + 0.09]], 0.008, hornMaterial, 8));
      }
    }
  }
}

function seatRider(rider, sizeScale, bodyOffset = 0) {
  // Scale the animal around its feet while keeping every rider human-sized.
  // Compensating around the seat keeps its distance to the pelvis unchanged.
  const inverse = 1 / sizeScale;
  rider.root.scale.setScalar(inverse);
  rider.root.position.copy(saddleAnchor).multiplyScalar(1 - inverse);
  rider.root.position.y += bodyOffset;
}

export function buildDinosaur(riderIndex = 0, mountId = "allosaurus") {
  const definition = mountDefinition(mountId);
  const { skin, belly, horn } = mountMaterials(definition);
  const sole = belly.clone();
  sole.color.copy(skin.color).multiplyScalar(0.1);
  sole.map = null;
  sole.roughness = 0.96;
  const root = new THREE.Group();
  root.scale.setScalar(definition.sizeScale);
  const body = new THREE.Group();
  body.position.set(0, 1.97, 0.25);
  root.add(body);
  anatomicalPart(body, [[-1.45, 0.1, 0.07, 0.08], [-1.12, 0.08, 0.4, 0.49], [-0.65, 0.04, 0.6, 0.67], [0.05, 0, 0.66, 0.73], [0.75, 0.05, 0.5, 0.61], [1.35, 0.02, 0.13, 0.19]], skin);
  ellipsoid(body, belly, [0, -0.25, -0.36], [0.51, 0.47, 0.89], [0.15, 0, 0]);
  ellipsoid(body, skin, [0, 0.13, -0.85], [0.47, 0.61, 0.65], [0.4, 0, 0]);
  // A thick, curved neck connects to a muscular, expressive head.
  const neck = new THREE.Group();
  neck.position.set(0, 2.49, -0.94);
  root.add(neck);
  anatomicalPart(neck, [[-0.54, 0.35, 0.23, 0.3], [-0.32, 0.25, 0.31, 0.45], [0, 0, 0.37, 0.56], [0.32, -0.3, 0.34, 0.47], [0.5, -0.43, 0.14, 0.17]], skin);
  ellipsoid(neck, belly, [0, -0.14, -0.28], [0.29, 0.48, 0.17], [-0.3, 0, 0]);
  const head = new THREE.Group();
  head.position.set(0, 3.02, -1.48);
  root.add(head);
  anatomicalPart(head, [[-1.19, -0.04, 0.07, 0.07], [-1.03, -0.01, 0.25, 0.18], [-0.72, 0.02, 0.3, 0.22], [-0.33, 0.06, 0.39, 0.31], [0.06, 0.015, 0.31, 0.3], [0.26, -0.09, 0.13, 0.14]], skin);
  // Mouth line and independently modeled lower jaw.
  ellipsoid(head, darkLeather, [0, -0.175, -0.58], [0.316, 0.035, 0.57]);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.18, 0.05);
  head.add(jaw);
  ellipsoid(jaw, belly, [0, -0.08, -0.57], [0.294, 0.13, 0.54]);
  for (const s of [-1, 1]) {
    ellipsoid(
      head,
      skin,
      [s * 0.29, 0.235, -0.22],
      [0.135, 0.065, 0.2],
      [0, 0, s * -0.22],
    );
    ellipsoid(
      head,
      horn,
      [s * 0.305, 0.31, -0.25],
      [0.13, 0.045, 0.18],
      [0, 0, s * -0.26],
    );
    ellipsoid(
      head,
      new THREE.MeshStandardMaterial({ color: "#bb8526", roughness: 0.25 }),
      [s * 0.392, 0.105, -0.28],
      [0.025, 0.063, 0.07],
    );
    ellipsoid(
      head,
      new THREE.MeshStandardMaterial({ color: "#11180d", roughness: 0.18 }),
      [s * 0.416, 0.107, -0.29],
      [0.007, 0.041, 0.021],
    );
    ellipsoid(head, bone, [s * 0.422, 0.129, -0.3], [0.004, 0.012, 0.012]);
    ellipsoid(
      head,
      darkLeather,
      [s * 0.205, 0.02, -1.09],
      [0.04, 0.025, 0.013],
    );
    head.add(curveMesh([[s * 0.388, 0.08, -0.365], [s * 0.411, 0.174, -0.28], [s * 0.378, 0.1, -0.19]], 0.018, skin, 9));
    for (let fold = 0; fold < 4; fold++) {
      neck.add(curveMesh([[s * 0.26, 0.05 - fold * 0.13, -0.27], [s * 0.35, -fold * 0.13, -0.05], [s * 0.3, -0.09 - fold * 0.13, 0.21]], 0.009, horn, 9));
    }
    for (let j = 0; j < 9; j++) {
      const tooth = new THREE.Mesh(cone, bone);
      tooth.scale.set(0.025, 0.083, 0.024);
      tooth.position.set(
        s * (0.24 + Math.sin((j / 9) * Math.PI) * 0.04),
        -0.187,
        -0.25 - j * 0.083,
      );
      tooth.rotation.z = Math.PI;
      head.add(tooth);
    }
    // Small grasping forelimbs.
    const arm = new THREE.Group();
    arm.position.set(s * 0.48, 2.25, -0.78);
    root.add(arm);
    body.attach(arm);
    ellipsoid(
      arm,
      skin,
      [s * 0.08, -0.16, -0.08],
      [0.15, 0.29, 0.17],
      [0.35, 0, s * 0.35],
    );
    segment(
      arm,
      skin,
      [s * 0.12, -0.35, -0.12],
      [s * 0.1, -0.5, -0.47],
      0.09,
      0.07,
    );
    ellipsoid(arm, skin, [s * 0.1, -0.51, -0.48], [0.11, 0.07, 0.12]);
    for (let t = 0; t < 3; t++)
      segment(
        arm,
        horn,
        [s * 0.1 + (t - 1) * 0.06, -0.52, -0.49],
        [s * 0.1 + (t - 1) * 0.07, -0.59, -0.68],
        0.025,
        0.005,
      );
    arm.scale.setScalar(definition.armScale);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.49, 1.84, 0.61);
    root.add(hip);
    const thigh = anatomicalPart(hip, [[-0.86, 0.24, 0.13, 0.16], [-0.55, 0.15, 0.23, 0.27], [-0.2, 0.02, 0.33, 0.4], [0.14, -0.05, 0.29, 0.34], [0.33, -0.02, 0.12, 0.16]], skin);
    thigh.geometry.rotateX(-Math.PI / 2);
    thigh.position.x = s * 0.065;
    const shin = new THREE.Group();
    shin.position.set(s * 0.07, -0.72, -0.27);
    hip.add(shin);
    const calf = anatomicalPart(shin, [[-0.95, -0.28, 0.07, 0.09], [-0.66, -0.23, 0.12, 0.14], [-0.28, -0.07, 0.17, 0.2], [0.12, 0.01, 0.1, 0.12]], skin);
    calf.geometry.rotateX(-Math.PI / 2);
    shin.add(curveMesh([[s * 0.05, -0.11, 0.04], [s * 0.08, -0.51, 0.26], [0, -0.86, 0.29]], 0.035, belly, 10));
    const foot = new THREE.Group();
    foot.position.set(0, -1.74, 0.15);
    hip.add(foot);
    anatomicalPart(foot, [[-0.34, -0.025, 0.16, 0.06], [-0.16, 0.015, 0.19, 0.095], [0.02, 0.05, 0.145, 0.105], [0.16, 0.035, 0.105, 0.08], [0.245, 0.02, 0.025, 0.025]], skin);
    ellipsoid(foot, skin, [0, 0.08, 0.095], [0.085, 0.12, 0.09]);
    ellipsoid(foot, sole, [0, -0.055, 0.025], [0.125, 0.045, 0.205]);
    for (let t = 0; t < 3; t++) {
      ellipsoid(
        foot,
        skin,
        [(t - 1) * 0.13, -0.03, -0.25],
        [0.085, 0.09, 0.26],
      );
      const claw = new THREE.Mesh(cone, horn);
      claw.position.set((t - 1) * 0.13, -0.02, -0.49);
      claw.rotation.x = -Math.PI / 2;
      claw.scale.set(0.055, 0.17, 0.05);
      foot.add(claw);
    }
    legs.push({
      hip, shin, foot, side: s,
      shinDirection: new THREE.Vector3(),
      shinRest: new THREE.Vector3(0, -0.92, 0.27).normalize(),
      shinLength: Math.hypot(0.92, 0.27),
      thighLength: Math.hypot(0.72, 0.27),
      thighRestAngle: Math.atan2(0.27, 0.72),
    });
  }
  // Articulated tapering tail with a slight natural curve.
  const tail = [], tailSurfaces = [];
  let parent = root;
  for (let i = 0; i < 8; i++) {
    const joint = new THREE.Group();
    joint.position.set(
      i === 0 ? 0 : 0,
      i === 0 ? 1.98 : 0,
      i === 0 ? 1.08 : 0.49,
    );
    parent.add(joint);
    const r = 0.43 * (1 - i / 8),
      next = Math.max(0.012, 0.43 * (1 - (i + 1) / 8));
    const surface = anatomicalPart(joint, [[0, 0, r, r * 0.9], [0.25, -0.005, (r + next) / 2, (r + next) * 0.45], [0.53, -0.01, next, next * 0.9]], skin, i * 0.53);
    surface.name = "tail-skin";
    tailSurfaces.push(surface);
    joint.rotation.x = -0.05;
    tail.push(joint);
    parent = joint;
  }
  // Bony ridges, subtle rather than fantasy spikes.
  root.updateMatrixWorld(true);
  const ridgeRay = new THREE.Raycaster(), ridgeUp = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 16; i++) {
    const z = -0.7 + i * 0.28,
      y = 2.56 - Math.max(0, z - 0.7) * 0.12;
    const ridge = new THREE.Mesh(cone, horn);
    ridge.scale.set(0.065, 0.13 * (1 - i / 20), 0.12);
    if (z < 1.08) {
      ridge.position.set(0, y, z);
      ridge.rotation.x = 0.25;
      root.add(ridge);
      body.attach(ridge);
    } else {
      // Anchor in each segment's own frame on the actual tapered mesh, with
      // the base slightly embedded. World-height placement left floating
      // plates above the tail root, even though their parents were correct.
      const index = Math.floor((i - 7) / 2), joint = tail[index];
      const localZ = 0.14 + ((i - 7) % 2) * 0.245;
      ridgeRay.set(joint.localToWorld(new THREE.Vector3(0, 2, localZ)),
        new THREE.Vector3(0, -1, 0).transformDirection(joint.matrixWorld));
      const hit = ridgeRay.intersectObject(tailSurfaces[index], false)[0];
      ridge.position.copy(joint.worldToLocal(hit.point));
      ridge.position.addScaledVector(hit.face.normal, ridge.scale.y / 2 - 0.025);
      ridge.quaternion.setFromUnitVectors(ridgeUp, hit.face.normal);
      joint.add(ridge);
    }
  }
  const saddle = new THREE.Group();
  saddle.position.copy(saddleAnchor);
  root.add(saddle);
  const saddleCloth = new THREE.MeshStandardMaterial({ ...fabric, color: "#9d6747" });
  roundedPart(saddle, saddleCloth, [1.13, 0.08, 1.37], [0, -0.07, 0.06], 0.04);
  ellipsoid(saddle, leather, [0, 0, 0], [0.55, 0.1, 0.62]);
  ellipsoid(saddle, darkLeather, [0, 0.065, 0.04], [0.32, 0.085, 0.37]);
  ellipsoid(saddle, leather, [0, 0.13, 0.37], [0.32, 0.13, 0.065]);
  ellipsoid(saddle, leather, [0, 0.1, -0.33], [0.29, 0.12, 0.06]);
  segment(saddle, darkLeather, [-0.5, 0, 0.15], [-0.55, -0.64, 0.1], 0.035);
  segment(saddle, darkLeather, [0.5, 0, 0.15], [0.55, -0.64, 0.1], 0.035);
  for (const s of [-1, 1]) {
    ellipsoid(saddle, leather, [s * 0.53, -0.2, 0.4], [0.13, 0.23, 0.19]);
    ellipsoid(saddle, steel, [s * 0.66, -0.18, 0.4], [0.01, 0.035, 0.03]);
    roundedPart(saddle, leather, [0.25, 0.34, 0.36], [s * 0.57, -0.24, 0.49], 0.055);
    roundedPart(saddle, darkLeather, [0.27, 0.11, 0.37], [s * 0.58, -0.09, 0.49], 0.03);
    for (let j = 0; j < 12; j++) segment(saddle, stitch, [s * 0.51, -0.015, -0.52 + j * 0.103], [s * 0.51, -0.015, -0.46 + j * 0.103], 0.006);
  }
  let rider = buildRider(riderIndex);
  seatRider(rider, definition.sizeScale);
  root.add(rider.root);
  const reins = [];
  const reinAnchors = [];
  for (const s of [-1, 1]) {
    const rein = new FlexibleRein(darkLeather, s);
    const anchor = new THREE.Object3D();
    anchor.position.set(s * 0.34, -0.02, -0.74);
    head.add(anchor);
    ring(head, steel, 0.035, 0.009, anchor.position.toArray(), [0, Math.PI / 2, 0]);
    reinAnchors.push(anchor);
    root.add(rein);
    reins.push(rein);
  }
  ring(
    head,
    leather,
    0.34,
    0.022,
    [0, -0.02, -0.74],
    [0, 0, 0],
  ).scale.y = 0.65;
  addMountFeatures(definition, body, head, horn);
  body.scale.x = definition.bodyWidth;
  neck.scale.x = definition.neckWidth;
  head.scale.set(definition.headWidth, definition.headHeight, definition.snoutLength);
  mergeStaticMeshes(root);
  legs.forEach((leg) => { leg.soleProfile = footSupportProfile(leg.foot); });
  const cactusContacts = [body, ...legs.flatMap(({ hip, shin, foot }) => [hip, shin, foot])]
    .flatMap((part) => part.children.filter((child) => child.isMesh))
    .map((mesh) => ({ mesh, bounds: new THREE.Box3() }));
  const home = new Map();
  root.traverse((o) => {
    if (o.isGroup)
      home.set(o, {
        position: o.position.clone(),
        quaternion: o.quaternion.clone(),
      });
  });
  return {
    root,
    body,
    neck,
    head,
    jaw,
    legs,
    gait: new DinosaurGait(),
    contactPosition: new THREE.Vector3(),
    tail,
    saddle,
    reins,
    reinAnchors,
    reinStart: new THREE.Vector3(),
    reinEnd: new THREE.Vector3(),
    get rider() {
      return rider;
    },
    setRider(index) {
      root.remove(rider.root);
      rider = buildRider(index);
      seatRider(rider, definition.sizeScale);
      root.add(rider.root);
      reins.forEach((rein) => { rein.initialized = false; });
    },
    home,
    cactusContacts,
    mountId: definition.id,
    sizeScale: definition.sizeScale,
    headCollision: definition.headCollision,
  };
}

export function cactusContactBounds(dino) {
  dino.root.updateMatrixWorld(true);
  return dino.cactusContacts.map(({ mesh, bounds }) => bounds.setFromObject(mesh, true));
}

export function animateDinosaur(dino, time, run = 0, duck = 0, jump = 0, dt = 1 / 60, fire = 0, verticalVelocity, speed = 14) {
  const motion = dino.gait.update(time, run, jump, dt, verticalVelocity, speed);
  const stride = run ? motion.phase : time * 1.3,
    breathing = Math.sin(time * 1.8);
  dino.body.position.y =
    1.97 +
    (run ? motion.bob : breathing * 0.018) -
    duck * 0.62 - motion.drop;
  dino.body.rotation.x = duck * 0.16 + motion.pitch;
  dino.body.rotation.z = run ? Math.sin(stride) * 0.012 * motion.strideWeight : 0;
  dino.neck.position.y =
    2.49 -
    duck * 1.04 +
    (run ? motion.bob * 0.65 : breathing * 0.02) - motion.drop * 0.65;
  dino.neck.rotation.x = -duck * 0.35 + motion.pitch * 0.5;
  dino.head.position.y =
    3.02 -
    duck * 1.18 +
    (run ? motion.bob * 0.35 : breathing * 0.025) - motion.drop * 0.5;
  dino.head.rotation.x = duck * 0.14 + Math.sin(time * 0.7) * 0.018 + fire * 0.07 + motion.pitch * 0.3;
  dino.jaw.rotation.x = 0.03 + Math.max(0, Math.sin(time * 0.6)) * 0.035 - fire * 0.45;
  dino.legs.forEach((leg, i) => {
    const pose = motion.legs[i];
    const support = supportHeight(leg.soleProfile, pose.pitch);
    const hipHeight = 1.84 + motion.bob - duck * 0.4 - motion.drop;
    // Keep a small knee bend rather than locking the joint at full reach.
    const extendedHeight = hipHeight - Math.sqrt(Math.max(0,
      (leg.thighLength + leg.shinLength - 0.012) ** 2 - pose.z ** 2));
    // In flight the floor is below the moving root. Clamping to the root's
    // original floor would bend the knees as straight legs pass underneath.
    const ankleHeight = THREE.MathUtils.lerp(support + pose.lift,
      Math.max(support - jump / dino.sizeScale, extendedHeight), pose.extension);
    pose.lift = ankleHeight - support;
    const joint = solveLeg(hipHeight,
      ankleHeight, pose.z, leg.thighLength, leg.shinLength, leg.thighRestAngle,
      0.08 * (1 - pose.extension));
    leg.hip.rotation.x = joint.hip;
    leg.hip.position.y = joint.y;
    leg.foot.position.set(leg.side * 0.07, joint.footY, joint.footZ);
    leg.foot.rotation.x = pose.pitch - joint.hip;
    const direction = leg.shinDirection.set(0, joint.footY + 0.72, joint.footZ + 0.27);
    leg.shin.quaternion.setFromUnitVectors(
      leg.shinRest,
      direction.normalize(),
    );
  });
  dino.tail[0].position.y = 1.98 + motion.bob * 0.7 - duck * 0.5 - motion.drop * 0.6;
  dino.tail.forEach((joint, i) => {
    joint.rotation.y = THREE.MathUtils.damp(joint.rotation.y,
      Math.sin((run ? stride : time * 1.1) - i * 0.45) * (0.035 + i * 0.004), 12 - i * 0.65, dt);
    joint.rotation.x = THREE.MathUtils.damp(joint.rotation.x,
      -0.05 + Math.sin((run ? stride * 2 : time * 2) - i * 0.4) * 0.012 + duck * 0.025 + motion.tailPitch * (i ? 0.12 : 1), 12 - i * 0.65, dt);
  });
  dino.saddle.position.y = 2.61 + (dino.body.position.y - 1.97);
  const rider = dino.rider;
  seatRider(rider, dino.sizeScale, dino.body.position.y - 1.97);
  rider.root.rotation.x = 0;
  rider.upperBody.rotation.x =
    -duck * 1.24 + (run ? Math.sin(stride * 2 - 0.4) * 0.012 * motion.strideWeight : 0) + motion.riderPitch;
  rider.head.rotation.x = duck * 0.8;
  rider.head.rotation.y = Math.sin(time * 0.55) * 0.06;
  rider.torso.rotation.x = -0.1;
  rider.limbs.forEach(({ arm }) => {
    arm.rotation.x = duck * 1.78;
  });
  dino.root.updateMatrixWorld(true);
  dino.reins.forEach((rein, i) => {
    dino.root.worldToLocal(rider.limbs[i].hand.getWorldPosition(dino.reinStart));
    dino.root.worldToLocal(dino.reinAnchors[i].getWorldPosition(dino.reinEnd));
    rein.update(dino.reinStart, dino.reinEnd, dt);
    rein.visible = true;
  });
}

export function buildCactus(height = 1.8) {
  const group = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({
    color: "#59684a",
    roughness: 0.9,
  });
  const lightGreen = new THREE.MeshStandardMaterial({
    color: "#71805a",
    roughness: 1,
  });
  const trunk = new THREE.Mesh(
    // Bury the rounded lower cap so a broad stem emerges from the soil.
    // The visible top stays at the obstacle's gameplay height.
    new THREE.CapsuleGeometry(0.18, height - 0.36 + 0.16, 6, 12),
    green,
  );
  trunk.position.y = (height - 0.16) / 2;
  trunk.castShadow = true;
  group.add(trunk);
  const tip = height * 0.52;
  for (const s of [-1, 1]) {
    const armHeight = height * (s === 1 ? 0.38 : 0.3);
    const shoulder = tip + height * (s === 1 ? 0.03 : -0.05);
    segment(
      group,
      green,
      [s * 0.12, shoulder, 0],
      [s * 0.5, shoulder, 0],
      0.115,
    );
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.115, armHeight - 0.23, 4, 10),
      green,
    );
    arm.position.set(s * 0.5, shoulder + armHeight / 2, 0);
    arm.castShadow = true;
    group.add(arm);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    segment(
      group,
      lightGreen,
      [Math.cos(a) * 0.178, 0.17, Math.sin(a) * 0.178],
      [Math.cos(a) * 0.178, height - 0.15, Math.sin(a) * 0.178],
      0.009,
    );
  }
  const spikePositions = [];
  for (let y = 0.25; y < height - 0.1; y += 0.13)
    for (let a = 0; a < 6; a++) {
      const angle = (a / 6) * Math.PI * 2 + y * 2;
      const x = Math.cos(angle) * 0.18,
        z = Math.sin(angle) * 0.18;
      spikePositions.push(x, y, z, x * 1.19, y + 0.025, z * 1.19);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(spikePositions, 3),
  );
  group.add(
    new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: "#c6b990",
        transparent: true,
        opacity: 0.65,
      }),
    ),
  );
  return mergeStaticMeshes(group);
}
export function buildCactusCluster(members) {
  const group = new THREE.Group();
  for (const { x, z, height } of members) {
    const cactus = buildCactus(height);
    cactus.position.set(x, 0, z);
    group.add(cactus);
  }
  return group;
}

export function buildPterosaur() {
  const root = new THREE.Group(),
    mat = new THREE.MeshStandardMaterial({
      ...leatherGrain,
      color: "#6a604e",
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
  const skinmat = new THREE.MeshStandardMaterial({
    color: "#6e6954",
    roughness: 0.95,
  });
  ellipsoid(root, skinmat, [0, 0, 0], [0.2, 0.25, 0.65]);
  ellipsoid(root, skinmat, [0, 0.16, -0.47], [0.2, 0.22, 0.3]);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.8, 8),
    new THREE.MeshStandardMaterial({ color: "#b49a6a", roughness: 0.85 }),
  );
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.1, -1);
  root.add(beak);
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 5), skinmat);
  crest.rotation.x = 0.8;
  crest.position.set(0, 0.36, -0.24);
  root.add(crest);
  for (const s of [-1, 1])
    ellipsoid(root, darkLeather, [s * 0.18, 0.18, -0.55], [0.025, 0.035, 0.04]);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    root.add(pivot);
    const geometry = new THREE.BufferGeometry();
    const vertices = [
      0.1,
      0,
      -0.28,
      s * 0.85,
      0.1,
      -0.6,
      s * 2.05,
      0,
      -0.9,
      s * 1.5,
      -0.03,
      0.1,
      s * 0.7,
      -0.05,
      0.5,
      0.1,
      0,
      0.35,
    ];
    const positions = [];
    for (let i = 1; i < 5; i++)
      positions.push(
        ...vertices.slice(0, 3),
        ...vertices.slice(i * 3, i * 3 + 3),
        ...vertices.slice((i + 1) * 3, (i + 1) * 3 + 3),
      );
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const wingUVs = [];
    for (let i = 0; i < positions.length; i += 3)
      wingUVs.push(Math.abs(positions[i]) / 2.05, (positions[i + 2] + 0.9) / 1.4);
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(wingUVs, 2));
    geometry.computeVertexNormals();
    const wing = new THREE.Mesh(geometry, mat);
    wing.castShadow = true;
    pivot.add(wing);
    segment(pivot, skinmat, [0, 0, -0.28], [s * 0.85, 0.1, -0.6], 0.055, 0.035);
    segment(
      pivot,
      skinmat,
      [s * 0.85, 0.1, -0.6],
      [s * 2.05, 0, -0.9],
      0.035,
      0.008,
    );
    for (let i = 0; i < 3; i++)
      segment(
        pivot,
        skinmat,
        [s * 0.85, 0.1, -0.6],
        [s * (0.5 + i * 0.45), -0.03, 0.4 - i * 0.1],
        0.012,
        0.004,
      );
    wings.push(pivot);
  }
  segment(root, skinmat, [0, 0, 0.4], [0, -0.05, 1.05], 0.09, 0.01);
  root.userData.wings = wings;
  return mergeStaticMeshes(root);
}
export function makePortrait(index) {
  const rider = buildRider(index);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(["#4e5140", "#3f5450", "#5e4e40"][index]);
  scene.add(new THREE.HemisphereLight("#fff0d1", "#262f2b", 2.5));
  const sun = new THREE.DirectionalLight("#ffdaa2", 3);
  sun.position.set(-3, 5, 5);
  scene.add(sun);
  scene.add(rider.root);
  const camera = new THREE.PerspectiveCamera(33, 90 / 120, 0.1, 20);
  camera.position.set(-0.75, 3.9, -2.7);
  camera.lookAt(0, 3.7, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(120, 160);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL();
  renderer.dispose();
  return url;
}
