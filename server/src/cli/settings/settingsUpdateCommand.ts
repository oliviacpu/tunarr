import { SettingsFileSchema } from '@/db/SettingsDB.js';
import { merge } from 'lodash-es';
import type { CommandModule } from 'yargs';
import { container } from '../../container.ts';
import type { ISettingsDB } from '../../db/interfaces/ISettingsDB.ts';
import { KEYS } from '../../types/inject.ts';

type SettingsUpdateCommandArgs = {
  pretty: boolean;
  settings: unknown;
  system?: unknown;
  featureFlags?: unknown;
};

function normalizeBooleanArguments(value: unknown, current: unknown): unknown {
  if (typeof current === 'boolean') {
    return value === 'true' ? true : value === 'false' ? false : value;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof current !== 'object' ||
    current === null
  )
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeBooleanArguments(child, Reflect.get(current, key)),
    ]),
  );
}

export const SettingsUpdateCommand: CommandModule<
  SettingsUpdateCommandArgs,
  SettingsUpdateCommandArgs
> = {
  command: 'update',
  describe: 'Update Tunarr settings directly.',
  builder: (yargs) =>
    yargs
      .usage('$0 settings update ')
      .option('pretty', {
        type: 'boolean',
        default: false,
        desc: 'Print settings JSON with spacing',
      })
      .option('settings', {
        type: 'string',
      })
      .option('system', {
        type: 'string',
        desc: 'System settings, using dotted keys such as --system.server.port=8000',
      })
      .option('featureFlags', {
        type: 'string',
        desc: 'Feature flags, using dotted keys such as --featureFlags.proxyArtwork=true',
      })
      .example([
        [
          '$0 settings update --settings.ffmpeg.ffmpegExecutablePath="/usr/bin/ffmpeg"',
          'Update FFmpeg executable path',
        ],
      ]),
  handler: async (args) => {
    const settingsDB = container.get<ISettingsDB>(KEYS.SettingsDB);
    const settings = settingsDB.getAll();
    const newSettings = merge({}, settings, {
      settings: normalizeBooleanArguments(args.settings, settings.settings),
      system: normalizeBooleanArguments(args.system, settings.system),
      featureFlags: normalizeBooleanArguments(
        args.featureFlags,
        settings.featureFlags,
      ),
    });

    try {
      const validSettings = SettingsFileSchema.parse(newSettings);
      await settingsDB.directUpdate((prev) => {
        prev.settings = validSettings.settings;
        prev.system = validSettings.system;
        prev.featureFlags = validSettings.featureFlags;
      });

      console.log(
        JSON.stringify(validSettings, undefined, args.pretty ? 4 : undefined),
      );
    } catch (e) {
      console.error(e);
    }
  },
};
