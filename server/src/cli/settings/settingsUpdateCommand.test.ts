import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs/yargs';
import { defaultSettings } from '../../db/SettingsDB.ts';
import { SettingsUpdateCommand } from './settingsUpdateCommand.ts';

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../container.ts', () => ({ container: { get: mock.get } }));
afterEach(() => vi.restoreAllMocks());

describe('settings update CLI', () => {
  it('updates system and feature flags while preserving nested settings and internal state', async () => {
    const persisted = defaultSettings('/tmp/tunarr-cli-test');
    const originalClientId = persisted.settings.clientId;
    persisted.pendingOperations.emptyTrashRequestedAt = 123;
    mock.get.mockReturnValue({
      getAll: () => persisted,
      directUpdate: vi.fn(async (update) => update(persisted)),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await yargs([
      'update',
      '--system.server.port=8123',
      '--system.logging.useEnvVarLevel=false',
      '--featureFlags.proxyArtwork=true',
      '--settings.ffmpeg.ffmpegExecutablePath=/test/ffmpeg',
    ])
      .command(SettingsUpdateCommand)
      .parseAsync();
    expect(persisted.system.server.port).toBe(8123);
    expect(persisted.system.logging.useEnvVarLevel).toBe(false);
    expect(persisted.featureFlags.proxyArtwork).toBe(true);
    expect(persisted.settings.ffmpeg.ffmpegExecutablePath).toBe('/test/ffmpeg');
    expect(persisted.settings.clientId).toBe(originalClientId);
    expect(persisted.pendingOperations.emptyTrashRequestedAt).toBe(123);
  });

  it('rejects an invalid update without persisting any section', async () => {
    const persisted = defaultSettings('/tmp/tunarr-cli-test');
    const directUpdate = vi.fn();
    mock.get.mockReturnValue({ getAll: () => persisted, directUpdate });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await yargs([
      'update',
      '--system.server.port=-1',
      '--featureFlags.proxyArtwork=true',
    ])
      .command(SettingsUpdateCommand)
      .parseAsync();
    expect(directUpdate).not.toHaveBeenCalled();
  });
});
