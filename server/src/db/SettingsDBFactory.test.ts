import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type * as WorkerThreads from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { GlobalOptions } from '../globals.ts';

const threadState = vi.hoisted(() => ({ isMainThread: true }));

vi.mock('node:worker_threads', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerThreads>()),
  get isMainThread() {
    return threadState.isMainThread;
  },
}));

describe('SettingsDBFactory', () => {
  let dir: string;
  let settingsPath: string;
  let options: GlobalOptions;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-settings-'));
    settingsPath = path.join(dir, 'settings.json');
    options = {
      database: dir,
      databaseDirectory: dir,
      log_level: undefined,
      verbose: 0,
    };
    // The factory caches instances per path and reads isMainThread at import
    // time, so each test needs a fresh copy of the module.
    vi.resetModules();
  });

  afterEach(async () => {
    threadState.isMainThread = true;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const loadFactory = async () =>
    (await import('./SettingsDBFactory.ts')).SettingsDBFactory;

  test('writes startup state on the main thread', async () => {
    const SettingsDBFactory = await loadFactory();

    new SettingsDBFactory(options).get();

    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as {
      migration: { isFreshSettings: boolean };
    };
    expect(written.migration.isFreshSettings).toBe(true);
  });

  test('does not write the settings file from a worker thread', async () => {
    const SettingsDBFactory = await loadFactory();
    new SettingsDBFactory(options).get();
    const before = await fs.readFile(settingsPath, 'utf-8');
    const beforeStat = await fs.stat(settingsPath);

    vi.resetModules();
    threadState.isMainThread = false;
    const WorkerSettingsDBFactory = await loadFactory();

    const settings = new WorkerSettingsDBFactory(options).get();

    expect(settings.systemSettings()).toBeDefined();
    expect(await fs.readFile(settingsPath, 'utf-8')).toBe(before);
    expect((await fs.stat(settingsPath)).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(await fs.readdir(dir)).toEqual(['settings.json']);
  });

  test('migrates version 1 without retaining dead keys or changing active settings', async () => {
    const { defaultSettings, CURRENT_VERSION } = await import(
      './SettingsDB.ts'
    );
    const original = defaultSettings(dir);
    original.settings.xmltv.programmingHours = 48;
    original.system.server.port = 18123;
    original.migration.hasEnabledLogRollByDefault = true;
    const legacy = {
      ...original,
      version: 1,
      settings: {
        ...original.settings,
        plexStream: { streamPath: 'direct', unknownLegacyValue: true },
        xmltv: {
          ...original.settings.xmltv,
          enableImageCache: 'unused-invalid-value',
        },
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(legacy));
    const SettingsDBFactory = await loadFactory();
    const settings = new SettingsDBFactory(options).get();
    expect(settings.getAll().version).toBe(CURRENT_VERSION);
    expect(settings.xmlTvSettings().programmingHours).toBe(48);
    expect(settings.systemSettings().server.port).toBe(18123);
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(written.version).toBe(2);
    expect(written.settings).not.toHaveProperty('plexStream');
    expect(written.settings.xmltv).not.toHaveProperty('enableImageCache');
    expect(written.settings.ffmpeg).toEqual(original.settings.ffmpeg);
    expect(written.featureFlags).toEqual(original.featureFlags);
    vi.resetModules();
    const ReloadedFactory = await loadFactory();
    const reloaded = new ReloadedFactory(options).get();
    expect(reloaded.getAll().version).toBe(2);
    expect(reloaded.xmlTvSettings().programmingHours).toBe(48);
  });

  test('loads a pre-subtitle settings file with empty preferences and unchanged versions', async () => {
    const { defaultSettings } = await import('./SettingsDB.ts');
    const original = defaultSettings(dir);
    const { subtitlePreferences: _omitted, ...legacyFfmpeg } =
      original.settings.ffmpeg;
    const legacy = {
      ...original,
      settings: {
        ...original.settings,
        ffmpeg: { ...legacyFfmpeg, enableLogging: true },
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(legacy));
    const SettingsDBFactory = await loadFactory();
    const settings = new SettingsDBFactory(options).get();
    expect(settings.ffmpegSettings().subtitlePreferences).toEqual([]);
    expect(settings.ffmpegSettings().enableLogging).toBe(true);
    expect(settings.ffmpegSettings().configVersion).toBe(5);
    expect(settings.getAll().version).toBe(2);
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(written.settings.ffmpeg.subtitlePreferences).toEqual([]);
    expect(written.settings.clientId).toBe(original.settings.clientId);
  });

  test('saves and reloads global preference order and row flags', async () => {
    const SettingsDBFactory = await loadFactory();
    const settings = new SettingsDBFactory(options).get();
    const preferences = [
      {
        languageCode: 'deu',
        filter: 'forced' as const,
        allowExternal: false,
        allowImageBased: true,
      },
      {
        languageCode: 'eng',
        filter: 'any' as const,
        allowExternal: true,
        allowImageBased: false,
      },
    ];
    await settings.updateFfmpegSettings({
      ...settings.ffmpegSettings(),
      subtitlePreferences: preferences,
    });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(written.settings.ffmpeg.subtitlePreferences).toEqual(preferences);
    vi.resetModules();
    const ReloadedFactory = await loadFactory();
    const reloaded = new ReloadedFactory(options).get();
    expect(reloaded.ffmpegSettings().subtitlePreferences).toEqual(preferences);
    expect(reloaded.getAll().version).toBe(2);
    expect(reloaded.ffmpegSettings().configVersion).toBe(5);
  });

  test('normalizes saved bibliographic codes without losing unrelated settings', async () => {
    const { defaultSettings } = await import('./SettingsDB.ts');
    const original = defaultSettings(dir);
    original.settings.xmltv.programmingHours = 48;
    original.settings.ffmpeg.subtitlePreferences = [
      {
        languageCode: 'ger',
        filter: 'default',
        allowExternal: false,
        allowImageBased: true,
      },
    ];
    await fs.writeFile(settingsPath, JSON.stringify(original));
    const SettingsDBFactory = await loadFactory();
    const settings = new SettingsDBFactory(options).get();
    expect(settings.ffmpegSettings().subtitlePreferences[0]?.languageCode).toBe(
      'deu',
    );
    expect(settings.xmlTvSettings().programmingHours).toBe(48);
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(written.settings.ffmpeg.subtitlePreferences[0].languageCode).toBe(
      'deu',
    );
  });

  test.each([
    null,
    {},
    [
      {
        languageCode: 'en',
        filter: 'any',
        allowExternal: false,
        allowImageBased: true,
      },
    ],
    [
      {
        languageCode: 'zzx',
        filter: 'any',
        allowExternal: false,
        allowImageBased: true,
      },
    ],
    [
      {
        languageCode: 'eng',
        filter: 'invalid',
        allowExternal: false,
        allowImageBased: true,
      },
    ],
    [{ languageCode: 'eng', allowExternal: false, allowImageBased: true }],
    [
      {
        languageCode: 'eng',
        filter: 'any',
        allowExternal: 'false',
        allowImageBased: true,
      },
    ],
    [{ languageCode: 'eng', filter: 'any', allowImageBased: true }],
    [{ languageCode: 'eng', filter: 'any', allowExternal: false }],
  ])(
    'refuses malformed saved preferences without replacing the file: %j',
    async (subtitlePreferences) => {
      const { defaultSettings } = await import('./SettingsDB.ts');
      const original = defaultSettings(dir);
      const saved = JSON.stringify({
        ...original,
        settings: {
          ...original.settings,
          ffmpeg: { ...original.settings.ffmpeg, subtitlePreferences },
        },
      });
      await fs.writeFile(settingsPath, saved);
      const SettingsDBFactory = await loadFactory();
      expect(() => new SettingsDBFactory(options).get()).toThrow(
        /subtitlePreferences/,
      );
      expect(await fs.readFile(settingsPath, 'utf-8')).toBe(saved);
    },
  );

  describe('log rolling default', () => {
    type WrittenSettings = {
      migration: Record<string, unknown>;
      system: { logging: { logRollConfig: Record<string, unknown> } };
    };

    const dailyRoll = {
      enabled: true,
      maxFileSizeBytes: 52428800,
      rolledFileLimit: 3,
      schedule: { type: 'every', increment: 1, unit: 'day', offsetMs: 0 },
    };

    const readSettings = async () =>
      JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as WrittenSettings;

    // Writes a settings file as an older release left it, then starts fresh.
    const writeLegacySettings = async (
      logRollConfig: Record<string, unknown>,
    ) => {
      const SettingsDBFactory = await loadFactory();
      new SettingsDBFactory(options).get();
      const settings = await readSettings();
      delete settings.migration.hasEnabledLogRollByDefault;
      settings.system.logging.logRollConfig = logRollConfig;
      await fs.writeFile(settingsPath, JSON.stringify(settings));
      vi.resetModules();
    };

    test('new installs roll daily', async () => {
      const SettingsDBFactory = await loadFactory();

      new SettingsDBFactory(options).get();

      const settings = await readSettings();
      expect(settings.system.logging.logRollConfig).toEqual(dailyRoll);
      expect(settings.migration.hasEnabledLogRollByDefault).toBe(true);
    });

    test('turns rolling on for existing installs that had it off', async () => {
      await writeLegacySettings({
        enabled: false,
        rolledFileLimit: 3,
        maxFileSizeBytes: 1048576,
      });
      const SettingsDBFactory = await loadFactory();

      new SettingsDBFactory(options).get();

      const settings = await readSettings();
      expect(settings.system.logging.logRollConfig).toEqual(dailyRoll);
      expect(settings.migration.hasEnabledLogRollByDefault).toBe(true);
    });

    test('keeps an existing enabled config', async () => {
      const custom = {
        enabled: true,
        rolledFileLimit: 5,
        maxFileSizeBytes: 10485760,
      };
      await writeLegacySettings(custom);
      const SettingsDBFactory = await loadFactory();

      new SettingsDBFactory(options).get();

      expect((await readSettings()).system.logging.logRollConfig).toEqual(
        custom,
      );
    });

    test('respects rolling turned off after the migration ran', async () => {
      const SettingsDBFactory = await loadFactory();
      new SettingsDBFactory(options).get();
      const settings = await readSettings();
      settings.system.logging.logRollConfig.enabled = false;
      await fs.writeFile(settingsPath, JSON.stringify(settings));
      vi.resetModules();
      const RestartedSettingsDBFactory = await loadFactory();

      new RestartedSettingsDBFactory(options).get();

      expect((await readSettings()).system.logging.logRollConfig.enabled).toBe(
        false,
      );
    });
  });
});
