export const DIFFICULTY_NAMES = { easy: "悠然", normal: "冒险", hard: "极限" };
const metres = (value) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function personalBests(saved) {
  return Object.fromEntries(Object.keys(DIFFICULTY_NAMES).map((difficulty) => [difficulty, metres(saved?.[difficulty])]));
}

export function recordBest(records, difficulty, distance) {
  const previous = metres(records[difficulty]), value = Math.max(previous, metres(distance));
  records[difficulty] = value;
  return { previous, value, isNew: value > previous };
}

export function animatedRecord(from, to, elapsed, duration = 0.95) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return Math.floor(from + (to - from) * (1 - (1 - t) ** 3));
}
