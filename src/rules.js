// Metres, seconds and a constant downward acceleration keep jumps independent of FPS.
export const GRAVITY = 22;
export const JUMP_VELOCITY = 10.5;
export function overlapsRunner(runner, obstacle) {
  const bird = obstacle.type === "bird",
    dx = Math.abs(obstacle.x - runner.x),
    z = obstacle.z;
  if (
    dx >= (bird ? 2.2 : 1.05) ||
    z <= -(bird ? 1.65 : 1.25) ||
    z >= (bird ? 0.8 : 0.85)
  )
    return false;
  if (bird)
    return (
      runner.y + 4.22 - runner.duck * 1.57 > obstacle.y - 0.25 &&
      runner.y + 0.4 < obstacle.y + 0.24
    );
  return runner.y + 0.15 < obstacle.height;
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
