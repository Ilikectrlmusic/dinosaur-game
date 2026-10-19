// Metres, seconds and a constant downward acceleration keep jumps independent of FPS.
export const GRAVITY = 22;
export const JUMP_VELOCITY = 10.5;
export const CONFIG = {
  easy: {
    label: "EXPLORER",
    speed: 10,
    maxSpeed: 24,
    acceleration: 0.22,
    gap: 2.7,
    description: "放慢脚步，感受旷野",
  },
  normal: {
    label: "ADVENTURER",
    speed: 14,
    maxSpeed: 30,
    acceleration: 0.28,
    gap: 2.05,
    description: "危机四伏，保持敏锐",
  },
  hard: {
    label: "SURVIVOR",
    speed: 19,
    maxSpeed: 36,
    acceleration: 0.34,
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

export function speedAtTime(difficulty, runTime) {
  const config = CONFIG[difficulty];
  return Math.min(
    config.maxSpeed,
    config.speed + Math.max(0, runTime) * config.acceleration,
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
    const height = random() < 0.5 ? CACTUS_HEIGHTS.medium : CACTUS_HEIGHTS.tall;
    return {
      type: "cactus", variant: "triple", height,
      // The leading cactus shares the single cactus's approach distance.
      // All three must be cleared in one jump before awarding the pass.
      depth: CACTUS_CLUSTER_SPACING * 2,
      members: [0, 1, 2].map((i) => ({ x: 0, z: i ? -i * CACTUS_CLUSTER_SPACING : 0, height })),
    };
  }
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
  return Math.abs(x - runner.x) < 1.05 && z > -1.25 && z < 0.85 && runner.y + 0.15 < height;
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
