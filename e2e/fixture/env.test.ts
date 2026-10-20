import assert from 'node:assert/strict';
import { test } from 'node:test';

const originalOffset = process.env.TUNARR_E2E_PORT_OFFSET;
let instance = 0;

async function loadEnvironment(offset?: string) {
  if (offset === undefined) {
    delete process.env.TUNARR_E2E_PORT_OFFSET;
  } else {
    process.env.TUNARR_E2E_PORT_OFFSET = offset;
  }
  try {
    const url = new URL('./env.ts', import.meta.url);
    url.searchParams.set('test', String(instance++));
    return await import(url.href);
  } finally {
    if (originalOffset === undefined) {
      delete process.env.TUNARR_E2E_PORT_OFFSET;
    } else {
      process.env.TUNARR_E2E_PORT_OFFSET = originalOffset;
    }
  }
}

test('default fixture ports remain unchanged', async () => {
  const env = await loadEnvironment();
  assert.equal(env.SERVER_PORT, 18000);
  assert.equal(env.SEARCH_PORT, 17700);
  assert.equal(env.WEB_PORT, 15173);
  assert.equal(env.SERVER_URL, 'http://localhost:18000');
  assert.equal(env.WEB_URL, 'http://localhost:15173');
});

test('one offset moves every fixture service and URL together', async () => {
  const env = await loadEnvironment('1000');
  assert.equal(env.SERVER_PORT, 19000);
  assert.equal(env.SEARCH_PORT, 18700);
  assert.equal(env.WEB_PORT, 16173);
  assert.equal(env.SERVER_URL, 'http://localhost:19000');
  assert.equal(env.WEB_URL, 'http://localhost:16173');
});

for (const offset of ['-1', '1.5', 'not-a-port', '47536']) {
  test(`refuses invalid port offset ${offset}`, async () => {
    await assert.rejects(loadEnvironment(offset), /TUNARR_E2E_PORT_OFFSET/);
  });
}
