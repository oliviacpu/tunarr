import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { measureWithConcurrentProbe } from './probe.ts';

function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Holds the thread, as a synchronous database query does
  }
}

const app = Fastify();
app.get('/ping', () => 'ok');

beforeAll(() => app.ready());
afterAll(() => app.close());

describe('measureWithConcurrentProbe', () => {
  test('counts a stall the operation ends with', async () => {
    const { probe, lag } = await measureWithConcurrentProbe({
      app,
      url: '/ping',
      operation: async () => {
        // Let the probe get going
        await new Promise((resolve) => setTimeout(resolve, 50));
        // Synchronous chunks joined only by microtasks, as chained database
        // queries are: the loop doesn't turn until the operation has resolved
        for (let i = 0; i < 4; i++) {
          busy(40);
          await Promise.resolve();
        }
      },
    });

    expect(probe.maxMs).toBeGreaterThanOrEqual(100);
    expect(lag.maxMs).toBeGreaterThanOrEqual(100);
  });
});
