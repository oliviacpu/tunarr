import {
  UpdateFfmpegSettingsRequestSchema,
  UpdateHdhrSettingsRequestSchema,
  UpdateMediaSourceSettingsRequestSchema,
  UpdateSystemSettingsRequestSchema,
  UpdateXmlTvSettingsRequestSchema,
} from '@tunarr/types/api';
import {
  FfmpegSettingsSchema,
  GlobalMediaSourceSettingsSchema,
  HdhrSettingsSchema,
  XmlTvSettingsSchema,
} from '@tunarr/types/schemas';
import { describe, expect, it } from 'vitest';

describe('settings update schemas', () => {
  it.each([
    [UpdateFfmpegSettingsRequestSchema, FfmpegSettingsSchema],
    [UpdateHdhrSettingsRequestSchema, HdhrSettingsSchema],
    [UpdateXmlTvSettingsRequestSchema, XmlTvSettingsSchema],
    [UpdateMediaSourceSettingsRequestSchema, GlobalMediaSourceSettingsSchema],
  ])(
    'covers every field without defaulting missing updates',
    (update, full) => {
      expect(Object.keys(update.shape).sort()).toEqual(
        Object.keys(full.shape).sort(),
      );
      expect(update.parse({})).toEqual({});
    },
  );

  it('does not fill nested objects with defaults', () => {
    const ffmpeg = { languagePreferences: {}, hdhrCaptionAppearance: {} };
    const system = {
      logging: { logRollConfig: {} },
      backup: {},
      server: { searchSettings: {} },
    };
    expect(UpdateFfmpegSettingsRequestSchema.parse(ffmpeg)).toEqual(ffmpeg);
    expect(UpdateSystemSettingsRequestSchema.parse(system)).toEqual(system);
  });
});
