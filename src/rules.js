import { cactusArmContacts, CACTUS_ARM_RADIUS } from "./cactus-shape.js";

// Metres, seconds and a constant downward acceleration keep jumps independent of FPS.
export const GRAVITY = 22;
export const JUMP_VELOCITY = 10.5;
export const CONFIG = {
  easy: {
    label: "EXPLORER",
    speed: 10,
    maxSpeed: 24,
    acceleration: 0.16,
    gap: 2.7,
    description: "放慢脚步，感受旷野",
  },
  normal: {
    label: "ADVENTURER",
    speed: 14,
    maxSpeed: 30,
    acceleration: 0.2,
    gap: 2.05,
    description: "危机四伏，保持敏锐",
  },
  hard: {
    label: "SURVIVOR",
    speed: 19,
    maxSpeed: 36,
    acceleration: 0.24,
    gap: 1.55,
    description: "野性全开，挑战你的极限",
  },
};
export const CACTUS_HEIGHTS = { small: 1.05, medium: 1.55, tall: 2.05 };
export const CACTUS_CLUSTER_DISTANCE = 300;
export const CACTUS_CLUSTER_SPACING = 1.05;
export const BIRD_UNLOCK_DISTANCE = 150;
export const BIRD_HEIGHTS = { low: 1.55, high: 3.55 };
export const BIRD_BOB = 0.08;
export const BIRD_SPEED_BONUS = 2.5;
export const ACCELERATION_TAPER_TIME = 120;
export const CACTUS_CLUSTER_PATTERNS = [
  [1.05, 1.55, 2.05], [2.05, 1.55, 1.05], [1.55, 2.05, 1.05],
  [1.05, 2.05, 1.55], [1.55, 1.05, 2.05], [2.05, 1.05, 1.55],
];

export function speedAtTime(difficulty, runTime) {
  const config = CONFIG[difficulty];
  return Math.min(
    config.maxSpeed,
    config.speed + config.acceleration * ACCELERATION_TAPER_TIME *
      Math.log1p(Math.max(0, runTime) / ACCELERATION_TAPER_TIME),
  );
}

export function chooseObstacle(distance, random = Math.random) {
  // The opening cactus teaches the jump before the two flight heights appear.
  if (distance >= BIRD_UNLOCK_DISTANCE && random() < 0.4) {
    const variant = random() < 0.5 ? "low" : "high";
    return {
      type: "bird",
      variant,
      flightHeight: BIRD_HEIGHTS[variant],
      height: 0.5,
    };
  }
  if (distance >= CACTUS_CLUSTER_DISTANCE && random() < 0.3) {
    const heights = CACTUS_CLUSTER_PATTERNS[Math.floor(random() * CACTUS_CLUSTER_PATTERNS.length)];
    const height = Math.max(...heights);
    return {
      type: "cactus", variant: "triple", height,
      // The leading cactus shares the single cactus's approach distance.
      // All three must be cleared in one jump before awarding the pass.
      depth: CACTUS_CLUSTER_SPACING * 2,
      members: heights.map((height, i) => ({ x: 0, z: i ? -i * CACTUS_CLUSTER_SPACING : 0, height })),
    };
  }
  // Every single-cactus height is available from the first wave.
  const variants = Object.keys(CACTUS_HEIGHTS);
  const variant = variants[Math.floor(random() * variants.length)];
  return { type: "cactus", variant, height: CACTUS_HEIGHTS[variant] };
}

export function spawnDelay(difficulty, speed, random = Math.random, depth = 0) {
  const config = CONFIG[difficulty];
  const birdAdvantage = 95 / speed - 95 / (speed + BIRD_SPEED_BONUS);
  const gap = config.gap * (config.speed / speed) ** 0.35;
  // A faster bird behind a cactus still leaves time to land and change posture.
  return Math.max(gap, 1.35 + birdAdvantage) + 0.15 + random() * 0.5 + depth / speed;
}

export function overlapsRunner(runner, obstacle) {
  if (obstacle.type !== "bird") {
    if (obstacle.members) return obstacle.members.some((member) => overlapsCactus(
      runner, obstacle.x + member.x, obstacle.z + member.z, member.height,
    ));
    return overlapsCactus(runner, obstacle.x, obstacle.z, obstacle.height);
  }
  if (Math.abs(obstacle.x - runner.x) >= 2.2 || obstacle.z <= -1.65 || obstacle.z >= 0.8) return false;
  return runner.y + 4.22 - runner.duck * 1.57 > obstacle.y - 0.25 && runner.y + 0.4 < obstacle.y + 0.24;
}
function overlapsCactus(runner, x, z, height) {
  // Runtime bounds follow the rendered feet, calves, thighs and belly. The
  // reference envelope also lets rule simulations check a conservative jump.
  const bounds = runner.cactusBounds || [{
    min: { x: runner.x - 0.75, y: runner.y + 0.35, z: -0.55 },
    max: { x: runner.x + 0.75, y: runner.y + 2.6, z: 0.45 },
  }];
  if (z < -3 || z > 3 || Math.abs(x - runner.x) > 2) return false;
  const touches = (ax, ay, az, bx, by, bz, radius) => bounds.some((box) => {
    const dx = Math.max(box.min.x - Math.max(ax, bx), Math.min(ax, bx) - box.max.x, 0);
    const dy = Math.max(box.min.y - Math.max(ay, by), Math.min(ay, by) - box.max.y, 0);
    const dz = Math.max(box.min.z - Math.max(az, bz), Math.min(az, bz) - box.max.z, 0);
    // A small inward tolerance prevents grazing empty space beside the mesh.
    return dx * dx + dy * dy + dz * dz < (radius - 0.025) ** 2;
  });
  if (touches(x, 0.02, z, x, height - 0.18, z, 0.18)) return true;
  for (const side of [-1, 1]) {
    for (const point of cactusArmContacts(height, side))
      if (touches(x + point.x, point.y, z, x + point.x, point.y, z, CACTUS_ARM_RADIUS)) return true;
  }
  return false;
}
export function advanceJump(y, vy, dt) {
  if (y <= 0 && vy <= 0) return { y: 0, vy: 0, landed: false };
  // Analytical integration avoids losing jump height at lower frame rates.
  const nextY = y + vy * dt - 0.5 * GRAVITY * dt * dt,
    nextV = vy - GRAVITY * dt;
  return nextY <= 0
    ? { y: 0, vy: 0, landed: true }
    : { y: nextY, vy: nextV, landed: false };
}
