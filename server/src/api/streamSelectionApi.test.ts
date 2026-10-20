import 'reflect-metadata';
import swagger from '@fastify/swagger';
import type { StreamSelectionProfile } from '@tunarr/types/schemas';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { copyPreMigratedDb } from '../testing/testDbFactory.ts';
import { streamSelectionRouter } from './streamSelectionApi.ts';

const prefix = '/api/stream-selection-profiles';
const profile = {
  name: 'Internal profile',
  rules: [
    {
      condition: 'true',
      audioAction: { type: 'default' },
      subtitleAction: { type: 'disable' },
    },
  ],
};

describe('internal stream-selection API', () => {
  let app: ReturnType<typeof Fastify>;
  let sqlite: Database.Database;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'tunarr-internal-profiles-'));
    await copyPreMigratedDb(directory);
    sqlite = new Database(path.join(directory, 'db.db'));
    const db = drizzle(sqlite, { casing: 'snake_case' });
    app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler)
      .withTypeProvider<ZodTypeProvider>();
    app.decorateRequest('serverCtx', null);
    app.addHook('onRequest', (req, _res, done) => {
      (req as unknown as { serverCtx: unknown }).serverCtx = {
        drizzleFactory: () => db,
      };
      done();
    });
    await app.register(swagger, {
      openapi: { info: { title: 'Test API', version: 'test' } },
      transform: jsonSchemaTransform,
    });
    app.get(
      '/api/public',
      { schema: { response: { 200: z.literal('public') } } },
      () => 'public',
    );
    await app.register(streamSelectionRouter, { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps all routes registered while excluding them from OpenAPI', () => {
    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', ''],
      ['GET', '/:id'],
      ['PUT', '/:id'],
      ['DELETE', '/:id'],
      ['POST', '/validate-expression'],
    ] as const) {
      expect(app.hasRoute({ method, url: prefix + suffix })).toBe(true);
    }
    const document = app.swagger();
    expect(document.paths).toHaveProperty('/api/public');
    expect(
      Object.keys(document.paths ?? {}).some((url) => url.startsWith(prefix)),
    ).toBe(false);
  });

  it('still creates, reads, updates and deletes profiles through the server', async () => {
    const createdResponse = await app.inject({
      method: 'POST',
      url: prefix,
      payload: profile,
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = createdResponse.json<StreamSelectionProfile>();
    const url = `${prefix}/${created.uuid}`;
    expect((await app.inject(url)).json()).toEqual(created);
    const list = (await app.inject(prefix)).json<StreamSelectionProfile[]>();
    expect(list).toContainEqual({
      ...created,
      usedByChannels: 0,
      usedByFillers: 0,
      usedByPrograms: 0,
    });
    const updated = await app.inject({
      method: 'PUT',
      url,
      payload: { ...profile, name: 'Renamed profile' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ ...created, name: 'Renamed profile' });
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(200);
    expect((await app.inject(url)).statusCode).toBe(404);
  });

  it('still validates CEL expressions', async () => {
    const valid = await app.inject({
      method: 'POST',
      url: `${prefix}/validate-expression`,
      payload: { expression: 'true' },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ valid: true });
    const invalid = await app.inject({
      method: 'POST',
      url: `${prefix}/validate-expression`,
      payload: { expression: '(' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      valid: false,
      error: expect.any(String),
    });
  });
});
