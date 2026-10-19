import * as THREE from "three";
import { mergeStaticMeshes } from "./model-detail.js";

// The rider stays near the origin. Every piece of ground scenery must therefore
// travel by the same distance as the track, including the distant mountains.
export class ScrollingScenery extends THREE.Group {
  constructor(tile, length = 420) {
    super();
    this.length = length;
    mergeStaticMeshes(tile);
    // Shared geometry keeps the extra scenery cheap. The outer copies change
    // in dense distant fog, which obscures the seam even when looking behind.
    for (let i = -2; i <= 2; i++) {
      const copy = i === 0 ? tile : tile.clone();
      copy.position.z = i * length;
      this.add(copy);
    }
  }

  update(distance) {
    this.position.z = THREE.MathUtils.euclideanModulo(distance, this.length);
  }
}
