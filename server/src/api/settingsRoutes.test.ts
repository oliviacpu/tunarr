import 'reflect-metadata';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { Low, Memory } from 'lowdb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, SettingsDB } from '../db/SettingsDB.ts';
import { setServerOptionsUnchecked } from '../globals.ts';
import { FeatureFlagService } from '../services/FeatureFlagService.ts';
import { ffmpegSettingsRouter } from './ffmpegSettingsApi.ts';
import { hdhrSettingsRouter } from './hdhrSettingsApi.ts';
import { settingsApi } from './settingsApi.ts';
import { systemApiRouter } from './systemApi.ts';
import { xmlTvSettingsRouter } from './xmltvSettingsApi.ts';

const effects = vi.hoisted(() => ({
  reschedule: vi.fn(),
  runNow: vi.fn(async () => undefined),
  extract: vi.fn(async () => undefined),
  backups: vi.fn(),
  rescans: vi.fn(),
}));

vi.mock('@/container.js', () => ({
  container: { get: () => ({ getPort: () => 17700 }) },
}));
vi.mock('@/services/Scheduler.js', () => ({
  GlobalScheduler: {
    getScheduledJob: () => effects,
    runScheduledJobNow: effects.extract,
  },
  scheduleBackupJobs: effects.backups,
}));
vi.mock('../services/rescanSchedule.ts', () => ({
  rescheduleRescanJobs: effects.rescans,
}));
vi.mock('@/util/logging/LoggerFactory.js', () => {
  const logger = {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
  };
  return {
    LoggerFactory: { child: () => logger, get: () => logger, root: logger },
    getEnvironmentLogLevel: () => undefined,
    getPrettyStreamOpts: () => ({}),
  };
});

describe('settings API contracts', () => {
  let app: ReturnType<typeof Fastify>;
  let settings: SettingsDB;

  beforeEach(async () => {
    vi.clearAllMocks();
    setServerOptionsUnchecked({
      database: '/data',
      log_level: 'info',
      verbose: 0,
      port: 8000,
      printRoutes: false,
    });
    const file = defaultSettings('/data');
    file.settings.ffmpeg.enableLogging = true;
    file.settings.ffmpeg.hdhrCaptionAppearance.upperCase = true;
    file.settings.hdhr.autoDiscoveryEnabled = false;
    file.featureFlags.proxyArtwork = true;
    settings = new SettingsDB(new Low(new Memory(), file));
    app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler)
      .withTypeProvider<ZodTypeProvider>();
    app.decorateRequest('serverCtx', null);
    app.addHook('onRequest', (req, _res, done) => {
      (req as unknown as { serverCtx: unknown }).serverCtx = {
        settings,
        eventService: { push: () => {} },
        featureFlagService: new FeatureFlagService(settings),
      };
      done();
    });
    await app.register(
      async (api) => {
        await api.register(ffmpegSettingsRouter);
        await api.register(xmlTvSettingsRouter);
        await api.register(hdhrSettingsRouter);
        await api.register(systemApiRouter);
        await api.register(settingsApi);
      },
      { prefix: '/api' },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['ffmpeg', '/ffmpeg-settings'],
    ['xmltv', '/xmltv-settings'],
    ['hdhr', '/hdhr-settings'],
    ['media-source', '/settings/media-source'],
    ['system', '/system/settings'],
    ['feature-flags', '/system/feature-flags'],
  ])(
    '%s exposes the canonical path and matching legacy alias',
    async (section, alias) => {
      const canonical = await app.inject(`/api/settings/${section}`);
      const legacy = await app.inject(`/api${alias}`);
      expect(canonical.statusCode).toBe(200);
      expect(legacy.json()).toEqual(canonical.json());
      const before = structuredClone(settings.getAll());
      const empty = await app.inject({
        method: 'PUT',
        url: `/api/settings/${section}`,
        payload: {},
      });
      expect(empty.statusCode).toBe(200);
      expect(settings.getAll()).toEqual(before);
    },
  );

  it.each([
    ['ffmpeg', { hdhrCaptionAppearance: { maxLines: 1 } }],
    ['xmltv', { refreshStartHour: 30 }],
    ['hdhr', { tunerCount: 0 }],
    ['media-source', { rescanIntervalHours: 1.5 }],
    ['system', { server: { port: 0 } }],
    ['feature-flags', { proxyArtwork: 'false' }],
  ])(
    '%s rejects invalid fields with one error shape and no writes',
    async (section, payload) => {
      const before = structuredClone(settings.getAll());
      const response = await app.inject({
        method: 'PUT',
        url: `/api/settings/${section}`,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ message: expect.any(String) });
      expect(settings.getAll()).toEqual(before);
    },
  );

  it('merges nested FFmpeg fields and runs extraction only when enabled', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/ffmpeg',
      payload: {
        hdhrCaptionAppearance: { textColor: 'yellow' },
        enableSubtitleExtraction: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(settings.ffmpegSettings()).toMatchObject({
      enableLogging: true,
      enableSubtitleExtraction: true,
      hdhrCaptionAppearance: { textColor: 'yellow', upperCase: true },
    });
    expect(effects.extract).toHaveBeenCalledOnce();
    await app.inject({
      method: 'PUT',
      url: '/api/ffmpeg-settings',
      payload: { enableFileLogging: true },
    });
    expect(settings.ffmpegSettings().enableLogging).toBe(true);
    expect(effects.extract).toHaveBeenCalledOnce();
  });

  it('preserves nested system values and clears optional values explicitly', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/system',
      payload: {
        server: { searchSettings: { maxIndexingMemory: 100 } },
        logging: { logRollConfig: { enabled: false } },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(settings.systemSettings()).toMatchObject({
      server: {
        port: 8000,
        searchSettings: { maxIndexingMemory: 100, snapshotIntervalHours: 4 },
      },
      logging: { logRollConfig: { enabled: false, rolledFileLimit: 3 } },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/settings/system',
      payload: {
        server: { searchSettings: { maxIndexingMemory: null } },
        logging: { logRollConfig: { schedule: null, maxFileSizeBytes: null } },
      },
    });
    expect(
      settings.systemSettings().server.searchSettings.maxIndexingMemory,
    ).toBeUndefined();
    expect(settings.systemSettings().logging.logRollConfig).toEqual({
      enabled: false,
      rolledFileLimit: 3,
    });
    expect(effects.backups).not.toHaveBeenCalled();
  });

  it('preserves tuner and feature values omitted from legacy PUT requests', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/hdhr-settings',
      payload: { tunerCount: 4 },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/system/feature-flags',
      payload: { tonemapEnabled: true },
    });
    expect(settings.hdhrSettings()).toEqual({
      tunerCount: 4,
      autoDiscoveryEnabled: false,
    });
    expect(settings.featureFlags()).toMatchObject({
      tonemapEnabled: true,
      proxyArtwork: true,
    });
  });

  it.each([
    'ffmpeg',
    'xmltv',
    'hdhr',
    'media-source',
    'system',
    'feature-flags',
  ])('returns the shared error body on failed %s writes', async (section) => {
    vi.spyOn(settings, 'directUpdate').mockRejectedValueOnce(
      new Error('disk failed'),
    );
    const response = await app.inject({
      method: 'PUT',
      url: `/api/settings/${section}`,
      payload: {},
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: expect.any(String) });
    expect(settings.ffmpegSettings().enableLogging).toBe(true);
  });

  it('replaces complete arrays and reschedules saved backup configurations', async () => {
    const languages = [
      { iso6391: 'ja', iso6392: 'jpn', displayName: 'Japanese' },
    ];
    await app.inject({
      method: 'PUT',
      url: '/api/settings/ffmpeg',
      payload: {
        languagePreferences: { preferences: languages },
      },
    });
    expect(settings.ffmpegSettings().languagePreferences.preferences).toEqual(
      languages,
    );
    await app.inject({
      method: 'PUT',
      url: '/api/settings/system',
      payload: {
        backup: { configurations: [] },
      },
    });
    expect(effects.backups).toHaveBeenCalledExactlyOnceWith({
      configurations: [],
    });
  });

  it.each(['ffmpeg', 'xmltv', 'hdhr'])(
    'removes the unused %s reset',
    async (section) => {
      expect(
        (await app.inject({ method: 'POST', url: `/api/${section}-settings` }))
          .statusCode,
      ).toBe(404);
    },
  );
});
