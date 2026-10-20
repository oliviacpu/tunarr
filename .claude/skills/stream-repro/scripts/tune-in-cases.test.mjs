import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resetSession, tuneInCase } from './tune-in-cases.mjs';

test('100 attempts distribute cold resets and second viewers across both channels', () => {
  const cases = Array.from({ length: 100 }, (_, i) => tuneInCase(i));
  for (const channelIndex of [0, 1]) {
    assert.equal(cases.filter((c) => c.channelIndex === channelIndex && c.cold).length, 3);
    assert.equal(cases.filter((c) => c.channelIndex === channelIndex && c.secondViewer).length, 5);
  }
});
test('stress cases preserve alternating channel switches', () => {
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => tuneInCase(i).channelIndex), [0, 1, 0, 1, 0]);
});

for (const status of [201, 404]) {
  test(`cold reset accepts HTTP ${status}`, async () => {
    await resetSession('http://test.invalid/sessions', async (_, options) => {
      assert.equal(options.method, 'DELETE');
      return new Response(null, { status });
    });
  });
}
for (const status of [500, 503]) {
  test(`cold reset rejects HTTP ${status}`, async () => {
    await assert.rejects(resetSession('http://test.invalid/sessions', async () => new Response(null, { status })), new RegExp(`HTTP ${status}`));
  });
}
test('cold reset preserves network failures', async () => {
  await assert.rejects(resetSession('http://test.invalid/sessions', async () => { throw new Error('offline'); }), /offline/);
});
