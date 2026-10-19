import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Keep every animated joint, but batch its stationary details by material.
export function mergeStaticMeshes(root) {
  for (const child of [...root.children]) if (child.isGroup) mergeStaticMeshes(child);
  const batches = new Map();
  for (const child of [...root.children]) {
    if (!child.isMesh || child.isInstancedMesh || child.userData.keepSeparate || Array.isArray(child.material)) continue;
    const key = child.material.uuid;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(child);
  }
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const indexed = meshes.every((mesh) => mesh.geometry.index);
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      let geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
      if (!indexed && geometry.index) {
        const converted = geometry.toNonIndexed();
        geometry.dispose();
        geometry = converted;
      }
      if (mesh.material.vertexColors && !geometry.attributes.color) {
        const colors = new Float32Array(geometry.attributes.position.count * 3).fill(1);
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      return geometry;
    });
    const geometry = mergeGeometries(geometries);
    geometries.forEach((part) => part.dispose());
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, meshes[0].material);
    merged.castShadow = meshes.some((mesh) => mesh.castShadow);
    merged.receiveShadow = meshes.some((mesh) => mesh.receiveShadow);
    for (const mesh of meshes) root.remove(mesh);
    root.add(merged);
  }
  return root;
}

// Smooth anatomical cross-sections, rather than a stack of disconnected spheres.
export function loftGeometry(sections, radialSegments = 24) {
  const curve = new THREE.CatmullRomCurve3(sections.map(([z, y, width]) => new THREE.Vector3(z, y, width)));
  const heights = new THREE.CatmullRomCurve3(sections.map(([z, y, width, height]) => new THREE.Vector3(z, height, 0)));
  const rings = (sections.length - 1) * 5;
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, point = curve.getPoint(t), height = heights.getPoint(t).y;
    for (let j = 0; j <= radialSegments; j++) {
      const angle = j / radialSegments * Math.PI * 2;
      positions.push(Math.cos(angle) * Math.max(0.005, point.z), point.y + Math.sin(angle) * Math.max(0.005, height), point.x);
      uvs.push(j / radialSegments, t);
      if (i < rings && j < radialSegments) {
        const a = i * (radialSegments + 1) + j, b = a + radialSegments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  for (const end of [0, 1]) {
    const section = end ? sections.at(-1) : sections[0];
    const center = positions.length / 3;
    positions.push(0, section[1], section[0]);
    uvs.push(0.5, end);
    const start = end ? rings * (radialSegments + 1) : 0;
    for (let j = 0; j < radialSegments; j++) {
      if (end) indices.push(center, start + j, start + j + 1);
      else indices.push(center, start + j + 1, start + j);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function curveMesh(points, radius, material, segments = 16) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 5, false), material);
  mesh.castShadow = true;
  return mesh;
}
