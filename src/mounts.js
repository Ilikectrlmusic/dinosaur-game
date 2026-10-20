export const MOUNTS = [
  {
    id: "allosaurus", name: "异特龙", english: "ALLOSAURUS",
    description: "苔绿鳞甲 · 敏捷猎手", skin: "#ccd0ad", belly: "#e2ca95", horn: "#77795b",
    bodyWidth: 1, neckWidth: 1, headWidth: 1, headHeight: 1, snoutLength: 1, armScale: 1,
  },
  {
    id: "carnotaurus", name: "牛龙", english: "CARNOTAURUS",
    description: "赤铜双角 · 厚重骨甲", skin: "#ac6144", belly: "#c99b78", horn: "#cab699",
    bodyWidth: 1.08, neckWidth: 1.12, headWidth: 1.17, headHeight: 1.16, snoutLength: 0.83, armScale: 0.55,
    headCollision: { size: [0.65, 0.43, 0.67], offset: [0, 0.16, -0.35] },
  },
  {
    id: "dilophosaurus", name: "双脊龙", english: "DILOPHOSAURUS",
    description: "蓝灰鳞片 · 琥珀双冠", skin: "#54838b", belly: "#c5c2a0", horn: "#7a7562",
    bodyWidth: 0.87, neckWidth: 0.8, headWidth: 0.86, headHeight: 0.9, snoutLength: 1.13, armScale: 1.06,
    headCollision: { size: [0.29, 0.5, 0.71], offset: [0, 0.2, -0.4] },
  },
];

export function mountDefinition(id) {
  return MOUNTS.find((mount) => mount.id === id) || MOUNTS[0];
}
