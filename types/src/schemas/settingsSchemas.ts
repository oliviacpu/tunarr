import z from 'zod/v4';
import { type TupleToUnion } from '../util.js';
import { GlobalSubtitlePreferenceSchema } from './subtitleSchema.js';
import { ScheduleSchema } from './utilSchemas.js';

export const XmlTvSettingsSchema = z.object({
  programmingHours: z.number().default(12),
  refreshHours: z.number().default(4),
  // An hour of the day (server time, 0-23) the scheduled full rebuild runs
  // at: it runs then and every refreshHours around the clock, so 6 hours from
  // 23 is 05:00, 11:00, 17:00 and 23:00, and 24 hours from 3 is once a day at
  // 03:00. programmingHours has to last until the next rebuild, up to two hours late
  // when the clocks go back (minimumXmlTvGuideHours in @tunarr/shared); the
  // API refuses a shorter guide
  refreshStartHour: z.number().int().min(0).max(23).default(0),
  outputPath: z.string().default(''),
  // If true, episodes will use the poster for their show in
  // the XMLTV file
  useShowPoster: z.boolean().default(false).catch(false),
  // The address links in the guide (programme and channel pictures) use, for
  // clients that load pictures themselves. Empty: the address the guide was
  // requested on.
  publicUrl: z.url().or(z.literal('')).default(''),
});

export const SupportedVideoFormats = ['h264', 'hevc', 'mpeg2'] as const;
export type SupportedVideoFormats = TupleToUnion<typeof SupportedVideoFormats>;
export const DefaultVideoFormat = 'h264';

export const SupportedHardwareAccels = [
  'none',
  'cuda',
  'vaapi',
  'qsv',
  'videotoolbox',
] as const;

export type SupportedHardwareAccels = TupleToUnion<
  typeof SupportedHardwareAccels
>;

export const DefaultHardwareAccel = 'none';

export const SupportedErrorScreens = [
  'static',
  'pic',
  'blank',
  'testsrc',
  'text',
  'kill',
] as const;

export const SupportedErrorAudioTypes = [
  'silent',
  'sine',
  'whitenoise',
] as const;

export const FfmpegLogLevels = [
  'panic',
  'fatal',
  'error',
  'warning',
  'info',
  'verbose',
  'debug',
  'trace',
] as const;

export type FfmpegLogLevel = TupleToUnion<typeof FfmpegLogLevels>;

// Curves for the software HDR -> SDR tone map. bt2390 needs jellyfin-ffmpeg's
// tonemapx filter; ffmpeg's own tonemap filter falls back to hable for it.
export const TonemapAlgorithms = [
  'hable',
  'bt2390',
  'mobius',
  'reinhard',
] as const;

export type TonemapAlgorithm = TupleToUnion<typeof TonemapAlgorithms>;

// Where closed caption lines sit across the screen: all starting at the same
// column with the block centred, each line centred on its own, or at the left
export const CaptionAlignments = [
  'centeredBlock',
  'centeredLines',
  'left',
] as const;

export type CaptionAlignment = TupleToUnion<typeof CaptionAlignments>;

// Colours 608 can draw caption text in. Black isn't offered: its code is
// optional, and decoders of FFmpeg's family (Plex's among them) draw it as
// white italics.
export const CaptionTextColors = [
  'white',
  'green',
  'blue',
  'cyan',
  'red',
  'yellow',
  'magenta',
] as const;

export type CaptionTextColor = TupleToUnion<typeof CaptionTextColors>;

// The box behind caption text. 'player' sends no code, so the player draws
// its own (Plex: a near-black box).
export const CaptionBackgroundColors = [
  'player',
  'black',
  'white',
  'green',
  'blue',
  'cyan',
  'red',
  'yellow',
  'magenta',
] as const;

export type CaptionBackgroundColor = TupleToUnion<
  typeof CaptionBackgroundColors
>;

export const CaptionBackgroundOpacities = [
  'opaque',
  'semiTransparent',
  'transparent',
] as const;

export type CaptionBackgroundOpacity = TupleToUnion<
  typeof CaptionBackgroundOpacities
>;

// How captions come on screen: pop-on (each caption whole, at once), roll-up
// (lines scroll up from the bottom, with 2, 3 or 4 on screen), or paint-on
// (characters appear as they arrive)
export const CaptionModes = [
  'popOn',
  'rollUp2',
  'rollUp3',
  'rollUp4',
  'paintOn',
] as const;

export type CaptionMode = TupleToUnion<typeof CaptionModes>;

// What captions show while two subtitles overlap: both in one block (older
// above newer), each where the subtitle file places it, or only the newest
export const CaptionOverlaps = ['together', 'apart', 'newest'] as const;

export type CaptionOverlap = TupleToUnion<typeof CaptionOverlaps>;

// How closed captions look. The defaults send what Tunarr always sent; the
// player decides the font, the text size and, unless a background colour is
// chosen, the box.
export const CaptionAppearanceSchema = z.object({
  textColor: z.enum(CaptionTextColors).default('white'),
  backgroundColor: z.enum(CaptionBackgroundColors).default('player'),
  backgroundOpacity: z.enum(CaptionBackgroundOpacities).default('opaque'),
  // The screen has 15 caption rows: captions at the bottom end on bottomRow,
  // captions placed at the top start on topRow
  bottomRow: z.number().int().min(1).max(15).default(15),
  topRow: z.number().int().min(1).max(15).default(1),
  maxLines: z.number().int().min(2).max(4).default(2),
  // Columns a line may use, of the 32 the screen has
  lineWidth: z.number().int().min(20).max(32).default(32),
  upperCase: z.boolean().default(false),
  mode: z.enum(CaptionModes).default('popOn'),
  // Italics and underline from the subtitle file
  keepStyles: z.boolean().default(true),
  // Placement from the subtitle file: top, middle, left and right, from
  // alignment overrides, ASS styles and ASS positions
  keepTopPlacement: z.boolean().default(true),
  overlappingCues: z.enum(CaptionOverlaps).default('together'),
});

export type CaptionAppearanceSettings = z.infer<typeof CaptionAppearanceSchema>;

// Some of the appearance settings, each one optional and without a default: a
// channel's own caption look sets only what it changes, and the rest comes
// from the global settings. (A default inside an optional field would fill in
// every field, overriding the global look with the defaults.) Keep the fields
// in step with CaptionAppearanceSchema.
export const CaptionAppearanceOverridesSchema = z.object({
  textColor: z.enum(CaptionTextColors).optional(),
  backgroundColor: z.enum(CaptionBackgroundColors).optional(),
  backgroundOpacity: z.enum(CaptionBackgroundOpacities).optional(),
  bottomRow: z.number().int().min(1).max(15).optional(),
  topRow: z.number().int().min(1).max(15).optional(),
  maxLines: z.number().int().min(2).max(4).optional(),
  lineWidth: z.number().int().min(20).max(32).optional(),
  upperCase: z.boolean().optional(),
  mode: z.enum(CaptionModes).optional(),
  keepStyles: z.boolean().optional(),
  keepTopPlacement: z.boolean().optional(),
  overlappingCues: z.enum(CaptionOverlaps).optional(),
});

export type CaptionAppearanceOverrides = z.infer<
  typeof CaptionAppearanceOverridesSchema
>;

export const FfmpegNumericLogLevels: Record<
  TupleToUnion<typeof FfmpegLogLevels>,
  number
> = {
  panic: 0,
  fatal: 8,
  error: 16,
  warning: 24,
  info: 32,
  verbose: 40,
  debug: 48,
  trace: 56,
};

export const LanguagePreferenceSchema = z.object({
  // ISO 639-1 (2-letter)
  iso6391: z.string().length(2),
  // ISO 639-2 (3-letter)
  iso6392: z.string().length(3),
  displayName: z.string(),
});

export const LanguagePreferencesSchema = z.object({
  preferences: z.array(LanguagePreferenceSchema).min(1),
});

export const FfmpegSettingsSchema = z.object({
  configVersion: z.number().default(5),
  ffmpegExecutablePath: z.string().default('/usr/bin/ffmpeg'),
  ffprobeExecutablePath: z.string().default('/usr/bin/ffprobe'),
  enableLogging: z.boolean().default(false),
  enableFileLogging: z.boolean().default(false),
  logLevel: z.enum(FfmpegLogLevels).optional().default('warning'),
  languagePreferences: LanguagePreferencesSchema.default({
    preferences: [{ iso6391: 'en', iso6392: 'eng', displayName: 'English' }],
  }),
  subtitlePreferences: z.array(GlobalSubtitlePreferenceSchema).default([]),
  transcodeDirectory: z.string().default('').optional(),
  scalingAlgorithm: z
    .enum(['bicubic', 'fast_bilinear', 'lanczos', 'spline'])
    .default('bicubic'),
  deinterlaceFilter: z
    .enum(['none', 'bwdif=0', 'bwdif=1', 'w3fdif', 'yadif=0', 'yadif=1'])
    .default('none'),
  hlsDirectOutputFormat: z.enum(['mkv', 'mpegts', 'mp4']).default('mpegts'),
  tonemapAlgorithm: z.enum(TonemapAlgorithms).default('hable'),
  // HLS stream mode: segment length, and how many segments must exist before
  // a client gets the playlist. Read when a channel's session starts.
  hlsReadAheadMaxThreads: z.number().int().min(0).max(256).default(16),
  hlsSegmentSeconds: z.number().int().min(1).max(10).default(4),
  hlsInitialSegmentCount: z.number().int().min(1).max(10).default(2),
  // How many seconds the .ts stream reading an HLS channel's playlist (what
  // HDHomeRun clients such as Plex get) may read ahead at start, instead of
  // real-time pace from the first byte
  hlsTsInitialBurstSeconds: z.number().int().min(0).max(60).default(0),
  // Closed captions (CEA-608) in the .ts stream HDHomeRun clients such as Plex
  // read, for HLS channels. Text subtitles that would be burned in for the full
  // program are sent as captions (and WebVTT) instead; forced ones stay burned.
  hdhrClosedCaptions: z.boolean().default(false),
  hdhrCaptionAlignment: z.enum(CaptionAlignments).default('centeredBlock'),
  hdhrCaptionAppearance: CaptionAppearanceSchema.default(() =>
    CaptionAppearanceSchema.parse({}),
  ),
  // Replaces every captioned program's captions with a looping set of numbered
  // samples, one per appearance feature, to see which ones a player honours
  hdhrCaptionTestPattern: z.boolean().default(false),
  enableSubtitleExtraction: z.boolean().optional().default(false),
});

// .github/scripts/pr-policy.cjs matches this name to detect new media sources.
// Update it if you rename this constant.
export const MediaSourceType = z.enum(['plex', 'jellyfin', 'emby', 'local']);

export const MediaSourceContentType = z.enum([
  'movies',
  'shows',
  'music_videos',
  'other_videos',
  'tracks',
]);

const BaseMediaSourceLibrarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mediaType: MediaSourceContentType,
  lastScannedAt: z.number().optional(),
  externalKey: z.string(),
  type: MediaSourceType,
  enabled: z.boolean(),
  isLocked: z.boolean(),
  unavailableSince: z.number().optional(),
});

export const MediaSourceLibrarySchema = z.object({
  ...BaseMediaSourceLibrarySchema.shape,
  get mediaSource() {
    return z
      .discriminatedUnion('type', [
        PlexServerSettingsSchema.omit({ libraries: true }),
        JellyfinServerSettingsSchema.omit({ libraries: true }),
        EmbyServerSettingsSchema.omit({ libraries: true }),
        LocalMediaSourceSchema.omit({ libraries: true, paths: true }),
      ])
      .optional();
  },
});

export const MediaSourceId = z.string().brand<'mediaSourceId'>();

export const MediaSourcePathReplacement = z.object({
  serverPath: z.string(),
  localPath: z.string(),
});

const BaseMediaSourceSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  libraries: z.array(BaseMediaSourceLibrarySchema),
  pathReplacements: z.array(MediaSourcePathReplacement),
});

const RemoteMediaSourceSettingsSchema = z.object({
  ...BaseMediaSourceSettingsSchema.shape,
  uri: z.string().trim(),
  accessToken: z.string().optional(),
  userId: z.string().nullable(),
  sendPlayStatusUpdates: z.boolean().default(false),
  username: z.string().nullable(),
});

export const PlexServerSettingsSchema = z.object({
  ...RemoteMediaSourceSettingsSchema.shape,
  type: z.literal(MediaSourceType.enum.plex),
  sendGuideUpdates: z.boolean(),
  index: z.number(),
  clientIdentifier: z.string().optional(),
});

export const JellyfinServerSettingsSchema = z.object({
  ...RemoteMediaSourceSettingsSchema.shape,
  type: z.literal('jellyfin'),
});

export const EmbyServerSettingsSchema = z.object({
  ...RemoteMediaSourceSettingsSchema.shape,
  type: z.literal('emby'),
});

export const LocalMediaSourceSchema = z.object({
  ...BaseMediaSourceSettingsSchema.shape,
  type: z.literal('local'),
  mediaType: MediaSourceContentType,
  paths: z.array(z.string().min(1)).nonempty(),
});

export const MediaSourceSettingsSchema = z.discriminatedUnion('type', [
  PlexServerSettingsSchema,
  JellyfinServerSettingsSchema,
  EmbyServerSettingsSchema,
  LocalMediaSourceSchema,
]);

export const HdhrSettingsSchema = z.object({
  autoDiscoveryEnabled: z.boolean().default(true),
  // The TunerCount the HDHomeRun device reports: how many channels a
  // client such as Plex lets its users watch at once
  tunerCount: z.number().int().min(1).default(2),
});

export const GlobalMediaSourceSettingsSchema = z.object({
  rescanIntervalHours: z.number().int().min(1).default(6),
});

export type GlobalMediaSourceSettings = z.infer<
  typeof GlobalMediaSourceSettingsSchema
>;

export const FileBackupOutputSchema = z.object({
  type: z.literal('file'),
  outputPath: z.string(),
  archiveFormat: z.union([z.literal('zip'), z.literal('tar')]).default('tar'),
  gzip: z.boolean().optional(), // Only valid if archive format is tar
  tempDir: z.string().optional(), // Defaults to OS-specific temp dir, can be relative path
  maxBackups: z.number().nonnegative().default(3),
});

export type FileBackupOutput = z.infer<typeof FileBackupOutputSchema>;

export const BackupOutputSchema = z.discriminatedUnion('type', [
  FileBackupOutputSchema,
]);

export const BackupConfigurationSchema = z.object({
  enabled: z.boolean().default(true),
  schedule: ScheduleSchema.default({
    type: 'every',
    increment: 1,
    unit: 'day',
    offsetMs: 4 * 60 * 60 * 1000,
  }),
  outputs: z.array(BackupOutputSchema),
});

export type BackupConfiguration = z.infer<typeof BackupConfigurationSchema>;

export const BackupSettingsSchema = z.object({
  configurations: z.array(BackupConfigurationSchema),
});

export type BackupSettings = z.infer<typeof BackupSettingsSchema>;
