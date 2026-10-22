import { test } from "node:test";
import assert from "node:assert/strict";
import { personalBests, recordBest, animatedRecord } from "../src/personal-best.js";

test("recording and reloading a best changes only its own difficulty", () => {
  const records = personalBests({ easy: 12, normal: 345, hard: 678 });
  assert.deepEqual(recordBest(records, "normal", 400.9), { previous: 345, value: 400, isNew: true });
  assert.deepEqual(records, { easy: 12, normal: 400, hard: 678 });
  assert.deepEqual(recordBest(records, "hard", 400), { previous: 678, value: 678, isNew: false });
  assert.deepEqual(recordBest(records, "normal", 400.99), { previous: 400, value: 400, isNew: false });
  assert.deepEqual(personalBests(JSON.parse(JSON.stringify(records))), records);
  assert.deepEqual(personalBests({ easy: -2, normal: NaN, hard: 89.9 }), { easy: 0, normal: 0, hard: 89 });
  assert.deepEqual(personalBests(null), { easy: 0, normal: 0, hard: 0 });
});

test("a new-record counter increases smoothly and ends exactly at the saved integer", () => {
  for (const fps of [30, 60, 120]) {
    let previous = 123;
    for (let i = 0; i < fps * 1.1; i++) {
      const value = animatedRecord(123, 567, i / fps);
      assert.ok(value >= previous && value <= 567);
      assert.ok(Number.isInteger(value));
      previous = value;
    }
    assert.equal(previous, 567);
  }
  assert.equal(animatedRecord(0, 123, 0), 0);
  assert.equal(animatedRecord(0, 123, 0.95), 123);
});
