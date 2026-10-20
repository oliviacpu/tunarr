import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { v4 } from 'uuid';

const getUsedBy = vi.hoisted(() => vi.fn());
vi.mock('../container.ts', () => ({
  container: { get: () => ({ getUsedBy }) },
}));
import { libraryUsageApi } from './libraryUsageApi.ts';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.resetAllMocks();
});

describe('library usage API', () => {
  test.each([
    ['filler-lists', 'fillerLists'],
    ['custom-shows', 'customShows'],
    ['smart_collections', 'smartCollections'],
  ])('serializes the %s bulk reference map', async (path, kind) => {
    const entity = v4();
    const result = {
      [entity]: [
        { id: v4(), name: 'Evening Movies', number: 7, slots: [1, 3] },
      ],
    };
    getUsedBy.mockResolvedValue(result);
    const app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler);
    apps.push(app);
    await app.register(libraryUsageApi, { prefix: '/api' });
    // Existing entity routes use /:id. The static usage path must win.
    app.get(`/api/${path}/:id`, () => ({ wrong: true }));
    const response = await app.inject(`/api/${path}/used-by`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(getUsedBy).toHaveBeenCalledExactlyOnceWith(kind);
  });

  test('reports a scan failure as an error rather than an empty reference map', async () => {
    getUsedBy.mockRejectedValue(new Error('Unreadable lineup'));
    const app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler);
    apps.push(app);
    await app.register(libraryUsageApi);
    const response = await app.inject('/filler-lists/used-by');
    expect(response.statusCode).toBe(500);
  });
});
