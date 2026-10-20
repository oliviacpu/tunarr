import type { NewTranscodeConfig } from '../../db/schema/TranscodeConfig.ts';
import type { Resolution } from '@tunarr/types';
import { v4 } from 'uuid';
import { booleanToNumber } from '../../util/sqliteUtil.ts';

// Frozen defaults for migrations written against the pre-Drizzle representation.
export const defaultTranscodeConfigLegacy = (
  isDefault?: boolean,
): NewTranscodeConfig => {
  return {
    threadCount: 0,
    audioBitRate: 192,
    audioBufferSize: 192 * 2,
    audioChannels: 2,
    audioFormat: 'aac',
    audioSampleRate: 48,
    hardwareAccelerationMode: 'none',
    name: isDefault ? 'Default' : `h264 @ 1920x1080`,
    resolution: JSON.stringify({
      widthPx: 1920,
      heightPx: 1080,
    } satisfies Resolution),
    uuid: v4(),
    videoBitRate: 2000,
    videoBufferSize: 4000,
    videoFormat: 'h264',
    disableChannelOverlay: booleanToNumber(false),
    normalizeFrameRate: booleanToNumber(false),
    videoBitDepth: 8,
    isDefault: booleanToNumber(!!isDefault),
  };
};
