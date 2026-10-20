import languages from '@cospired/i18n-iso-languages';
import z from 'zod/v4';
import type { TupleToUnion } from '../util.js';
import { ResolutionSchema } from './miscSchemas.js';
import {
  CaptionAlignments,
  CaptionAppearanceOverridesSchema,
} from './settingsSchemas.js';
import { ProgramSchema } from './programmingSchema.js';
import { SubtitlePreference } from './subtitleSchema.js';
import {
  ChannelIconSchema,
  ContentProgramTypeSchema,
  StrictChannelIconSchema,
} from './utilSchemas.js';

export const WatermarkSchema = z.object({
  url: z.string().optional(),
  enabled: z.boolean(),
  position: z
    .union([
      z.literal('top-left'),
      z.literal('top-right'),
      z.literal('bottom-left'),
      z.literal('bottom-right'),
    ])
    .default('bottom-right'),
  width: z.number().positive(),
  verticalMargin: z.number().min(0).max(100),
  horizontalMargin: z.number().min(0).max(100),
  duration: z.number().min(0).default(0),
  fixedSize: z.boolean().optional(),
  animated: z.boolean().optional(),
  opacity: z.number().min(0).max(100).int().optional().catch(100).default(100),
  fadeConfig: z
    .array(
      z.object({
        programType: ContentProgramTypeSchema.optional().catch(undefined),
        // Encodes on/off period of displaying the watermark in mins.
        // e.g. a 5m period fades in the watermark every 5th min and displays it
        // for 5 mins.
        periodMins: z.number().positive().min(1),
        // If true, the watermark will fade in immediately on channel stream start.
        // If false, the watermark will start not visible and fade in after periodMins.
        leadingEdge: z.boolean().optional().catch(true),
      }),
    )
    .optional(),
});

/**
 * The watermark as accepted from a client.
 *
 * Same split as StrictChannelIconSchema: identical handling of a *missing*
 * field, validation failure instead of silent substitution for an *invalid*
 * one. The `.catch()` calls in WatermarkSchema above are kept because that
 * schema also sits on channel responses, which are serialized from an
 * unvalidated JSON column.
 *
 * What they were hiding:
 * - `opacity: 150`, `-10`, `50.5` or `"50"` was stored as 100, fully opaque.
 * - `fadeConfig[].programType: "movies"` (not a ContentProgramType) became
 *   undefined, which means "no restriction" — so a fade rule the user scoped
 *   to one program type silently applied to every program on the channel.
 * - `fadeConfig[].leadingEdge: "false"`, as a form serialiser would send it,
 *   became true, the opposite of what was asked for.
 */
export const StrictWatermarkSchema = WatermarkSchema.extend({
  opacity: z.number().min(0).max(100).int().optional().default(100),
  fadeConfig: z
    .array(
      z.object({
        programType: ContentProgramTypeSchema.optional(),
        periodMins: z.number().positive().min(1),
        leadingEdge: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const FillerCollectionSchema = z.object({
  id: z.string(),
  weight: z.number(),
  cooldownSeconds: z.number(),
});

export const ChannelOfflineSchema = z.object({
  picture: z.string().optional(),
  soundtrack: z.string().optional(),
  mode: z.union([z.literal('pic'), z.literal('clip')]),
  // Filler list whose tracks play, loudness-normalized, under the offline picture during gaps
  musicListId: z.string().optional(),
  // Whether the gap music's artist and title show along the bottom of the
  // offline picture. On unless false.
  showNowPlaying: z.boolean().optional(),
  // The picture gaps get in the guide (XMLTV <icon>), when the offline picture
  // doesn't suit guide tiles: clients crop one picture to both tall and wide
  // tiles, so a square one with its content centred survives both
  guidePicture: z.string().optional(),
});

export const ChannelTranscodingOptionsSchema = z.object({
  targetResolution: ResolutionSchema.optional(),
  videoBitrate: z.number().optional(),
  videoBufferSize: z.number().optional(),
});

export const HlsChannelStreamMode = 'hls';
export const HlsConcatChannelStreamMode = 'hls_concat';
export const HlsSlowerChannelStreamMode = 'hls_slower';
export const HlsSlowerConcatChannelStreamMode = 'hls_slower_concat';
export const MpegTsChannelStreamMode = 'mpegts';
export const MpegTsConcatChannelStreamMode = 'mpegts_concat';
export const HlsDirectStreamMode = 'hls_direct';
export const HlsDirectConcatStreamMode = 'hls_direct_concat';
export const HlsDirectV2StreamMode = 'hls_direct_v2';
export const HlsDirectV2ConcatStreamMode = 'hls_direct_v2_concat';

export const ChannelStreamMode = {
  Hls: HlsChannelStreamMode,
  HlsSlower: HlsSlowerChannelStreamMode,
  MpegTs: MpegTsChannelStreamMode,
  HlsDirect: HlsDirectStreamMode,
  HlsDirectV2: HlsDirectV2StreamMode,
} as const;

export const ChannelConcatStreamMode = {
  Hls: HlsConcatChannelStreamMode,
  HlsSlower: HlsSlowerConcatChannelStreamMode,
  MpegTs: MpegTsConcatChannelStreamMode,
  HlsDirect: HlsDirectConcatStreamMode,
  HlsDirectV2: HlsDirectV2ConcatStreamMode,
} as const;

export const ChannelStreamModes = [
  ChannelStreamMode.Hls,
  ChannelStreamMode.HlsSlower,
  ChannelStreamMode.MpegTs,
  ChannelStreamMode.HlsDirect,
  ChannelStreamMode.HlsDirectV2,
] as const;

export const ChannelConcatStreamModes = [
  ChannelConcatStreamMode.Hls,
  ChannelConcatStreamMode.HlsSlower,
  ChannelConcatStreamMode.MpegTs,
  ChannelConcatStreamMode.HlsDirect,
  ChannelConcatStreamMode.HlsDirectV2,
] as const;

export type ChannelStreamMode = TupleToUnion<typeof ChannelStreamModes>;
export const ChannelStreamModeSchema = z.enum(ChannelStreamModes);

export type ChannelConcatStreamMode = TupleToUnion<
  typeof ChannelConcatStreamModes
>;
export const ChannelConcatStreamModeSchema = z.enum(ChannelConcatStreamModes);

export const StreamConnectionDetailsSchema = z.object({
  ip: z.ipv4().or(z.ipv6()),
  userAgent: z.string().optional(),
  lastHeartbeat: z.number().nonnegative().optional(),
  lastHeartbeatStr: z.iso.datetime({ offset: true }).optional(),
});

export const ChannelSessionSchema = z.object({
  type: z.enum([...ChannelStreamModes, ...ChannelConcatStreamModes]),
  state: z.string(),
  numConnections: z.number().nonnegative(),
  connections: z.array(StreamConnectionDetailsSchema),
});

/**
 * A channel's fixed audio track layout, for switchable audio in Plex Live TV: ISO 639-2 codes in output order. Every
 * program, gap and commercial on the channel then outputs exactly these tracks, so Plex, which keeps the track list it
 * saw at tune-in, offers the same audio menu all session. Empty = off (one track, as before).
 */
export const MaxChannelAudioTracks = 4;

/**
 * A known ISO 639-2 code in its terminological form: "deu" for "deu" and for
 * "ger" (20 languages have a bibliographic and a terminological code), or null
 * for a code that isn't a known language.
 */
export function canonicalAudioTrackLanguage(code: string): string | null {
  if (!/^[a-z]{3}$/.test(code)) {
    return null;
  }
  if (languages.getAlpha3TCodes()[code] !== undefined) {
    return code;
  }
  const alpha2 = languages.alpha3BToAlpha2(code);
  return (alpha2 && languages.alpha2ToAlpha3T(alpha2)) ?? null;
}

export const StrictChannelAudioTracksSchema = z
  .array(
    z
      .string()
      .regex(/^[a-z]{3}$/, 'Use three-letter ISO 639-2 codes, such as eng'),
  )
  .max(MaxChannelAudioTracks)
  .superRefine((codes, ctx) => {
    // Compared in canonical form, so "ger" and "deu" are one language
    const seen = new Set<string>();
    codes.forEach((code, i) => {
      const canonical = canonicalAudioTrackLanguage(code);
      if (canonical === null) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown language code: ${code}`,
          path: [i],
        });
        return;
      }
      if (seen.has(canonical)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each language can only be listed once',
          path: [i],
        });
      }
      seen.add(canonical);
    });
  });

/**
 * A channel's own closed-caption settings, for trying caption options on one
 * channel (a test channel) without changing them for every channel. What it
 * sets overrides the global closed-caption settings on this channel; what it
 * leaves out comes from them. The global closed-captions switch still turns
 * captions on. Null or empty = the global settings.
 */
export const ChannelCaptionsSchema = z.object({
  // The numbered caption samples on this channel only
  testPattern: z.boolean().optional(),
  alignment: z.enum(CaptionAlignments).optional(),
  appearance: CaptionAppearanceOverridesSchema.optional(),
});

export const ChannelSchema = z.object({
  disableFillerOverlay: z.boolean(),
  duration: z.number(),
  fallback: z.array(ProgramSchema).optional(),
  fillerCollections: z.array(FillerCollectionSchema).optional(),
  fillerRepeatCooldown: z.number().optional(),
  groupTitle: z.string(),
  guideFlexTitle: z.string().optional(),
  guideMinimumDuration: z.number(),
  icon: ChannelIconSchema,
  id: z.string(),
  name: z.string(),
  number: z.number(),
  offline: ChannelOfflineSchema,
  startTime: z.number(),
  stealth: z.boolean(),
  watermark: WatermarkSchema.optional(),
  onDemand: z.object({
    enabled: z.boolean(),
  }),
  programCount: z.number(),
  streamMode: ChannelStreamModeSchema,
  transcodeConfigId: z.uuid(),
  sessions: z.array(ChannelSessionSchema).optional(),
  subtitlesEnabled: z.boolean(),
  subtitlePreferences: z.array(SubtitlePreference).nonempty().optional(),
  audioTracks: z.array(z.string()).optional(),
  captions: ChannelCaptionsSchema.nullable().optional(),
});

// The write path validates strictly: a bad icon or watermark value is a 400,
// not a 200 that stored something else. The read path (ChannelSchema, used on
// channel responses) stays lenient so existing rows still serialize.
export const SaveableChannelSchema = ChannelSchema.omit({
  fallback: true, // Figure out how to update this
  programCount: true,
  sessions: true,
})
  .partial({
    onDemand: true,
  })
  .extend({
    icon: StrictChannelIconSchema,
    watermark: StrictWatermarkSchema.optional(),
    audioTracks: StrictChannelAudioTracksSchema.optional(),
  });

// A missing startTime leaves the stored value unchanged. Server-computed
// rebases are exact and must survive saves of unrelated settings.
export const UpdateChannelRequestSchema = SaveableChannelSchema.partial({
  startTime: true,
});

export const NewChannelSaveRequestSchema = z.object({
  type: z.literal('new'),
  channel: SaveableChannelSchema,
});

export const CopyChannelSaveRequestSchema = z.object({
  type: z.literal('copy'),
  channelId: z.string().uuid(),
});

export const CreateChannelRequestSchema = z.discriminatedUnion('type', [
  NewChannelSaveRequestSchema,
  CopyChannelSaveRequestSchema,
]);
