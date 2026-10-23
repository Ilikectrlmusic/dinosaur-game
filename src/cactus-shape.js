// One centreline for the visible arm and its collision samples. The quarter
// circle joins the horizontal branch and upright with matching tangents.
export const CACTUS_ARM_RADIUS = 0.115;

export function cactusArmPoint(height, side, t) {
  const shoulder = height * (side === 1 ? 0.55 : 0.47);
  const rise = height * (side === 1 ? 0.38 : 0.3) - CACTUS_ARM_RADIUS;
  const bend = Math.min(0.2, rise);
  const horizontal = 0.38 - bend, arc = bend * Math.PI / 2;
  const length = horizontal + arc + rise - bend;
  const distance = Math.max(0, Math.min(1, t)) * length;
  let x, y, tx, ty;
  if (distance <= horizontal) {
    x = 0.12 + distance; y = shoulder; tx = 1; ty = 0;
  } else if (distance < horizontal + arc) {
    const angle = (distance - horizontal) / bend;
    x = 0.5 - bend + bend * Math.sin(angle);
    y = shoulder + bend * (1 - Math.cos(angle));
    tx = Math.cos(angle); ty = Math.sin(angle);
  } else {
    x = 0.5; y = shoulder + bend + distance - horizontal - arc; tx = 0; ty = 1;
  }
  return { x: side * x, y, tx: side * tx, ty, length };
}

const collisionProfiles = new Map();
export function cactusArmContacts(height, side) {
  const key = `${height}:${side}`;
  if (!collisionProfiles.has(key)) {
    const steps = Math.ceil(cactusArmPoint(height, side, 0).length / 0.035);
    collisionProfiles.set(key, Array.from({ length: steps + 1 }, (_, i) => cactusArmPoint(height, side, i / steps)));
  }
  return collisionProfiles.get(key);
}
