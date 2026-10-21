import { z } from 'zod/v4';
import {
  CaptionAlignments,
  CaptionAppearanceOverridesSchema,
  FfmpegLogLevels,
  GlobalMediaSourceSettingsSchema,
  LanguagePreferenceSchema,
  TonemapAlgorithms,
} from '../schemas/settingsSchemas.js';

import { GlobalSubtitlePreferenceSchema } from '../schemas/subtitleSchema.js';

// Update bodies intentionally have no defaults: an omitted field stays omitted.
export const UpdateFfmpegSettingsRequestSchema = z.object({
  configVersion: z.number().optional(),
  ffmpegExecutablePath: z.string().optional(),
  ffprobeExecutablePath: z.string().optional(),
  enableLogging: z.boolean().optional(),
  enableFileLogging: z.boolean().optional(),
  logLevel: z.enum(FfmpegLogLevels).optional(),
  languagePreferences: z
    .object({
      preferences: z.array(LanguagePreferenceSchema).min(1).optional(),
    })
    .optional(),
  subtitlePreferences: z.array(GlobalSubtitlePreferenceSchema).optional(),
  transcodeDirectory: z.string().optional(),
  scalingAlgorithm: z
    .enum(['bicubic', 'fast_bilinear', 'lanczos', 'spline'])
    .optional(),
  deinterlaceFilter: z
    .enum(['none', 'bwdif=0', 'bwdif=1', 'w3fdif', 'yadif=0', 'yadif=1'])
    .optional(),
  hlsDirectOutputFormat: z.enum(['mkv', 'mpegts', 'mp4']).optional(),
  tonemapAlgorithm: z.enum(TonemapAlgorithms).optional(),
  hlsReadAheadMaxThreads: z.number().int().min(0).max(256).optional(),
  hlsSegmentSeconds: z.number().int().min(1).max(10).optional(),
  hlsInitialSegmentCount: z.number().int().min(1).max(10).optional(),
  hlsTsInitialBurstSeconds: z.number().int().min(0).max(60).optional(),
  hdhrClosedCaptions: z.boolean().optional(),
  hdhrCaptionAlignment: z.enum(CaptionAlignments).optional(),
  hdhrCaptionAppearance: CaptionAppearanceOverridesSchema.optional(),
  hdhrCaptionTestPattern: z.boolean().optional(),
  enableSubtitleExtraction: z.boolean().optional(),
});

export const UpdateHdhrSettingsRequestSchema = z.object({
  autoDiscoveryEnabled: z.boolean().optional(),
  tunerCount: z.number().int().min(1).optional(),
});

export const UpdateMediaSourceSettingsRequestSchema = z.object({
  rescanIntervalHours: GlobalMediaSourceSettingsSchema.shape.rescanIntervalHours
    .removeDefault()
    .optional(),
});

export const UpdateXmlTvSettingsRequestSchema = z.object({
  programmingHours: z.number().optional(),
  refreshHours: z.number().optional(),
  refreshStartHour: z.number().int().min(0).max(23).optional(),
  outputPath: z.string().optional(),
  useShowPoster: z.boolean().optional(),
  publicUrl: z.url().or(z.literal('')).optional(),
});
