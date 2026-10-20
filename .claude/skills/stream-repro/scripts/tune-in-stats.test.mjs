import assert from 'node:assert/strict';
import { test } from 'node:test';
import { medianSorted } from './tune-in-stats.mjs';

test('an even sample count averages both middle observations', () => {
  assert.equal(medianSorted([1, 3, 7, 100]), 5);
});
test('an odd sample count selects its middle observation', () => {
  assert.equal(medianSorted([1, 3, 100]), 3);
});
test('an empty sample has no median', () => {
  assert.equal(medianSorted([]), undefined);
});
test('a single sample and zero-duration samples remain valid', () => {
  assert.equal(medianSorted([12]), 12);
  assert.equal(medianSorted([0, 0]), 0);
});
