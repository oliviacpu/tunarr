import fs from 'node:fs/promises';
import type { StreamLineupItem } from '../../db/derived_types/StreamLineup.ts';
import { isImageBasedSubtitle } from '../util.ts';
import type { SubtitleStreamDetails } from '../types.ts';
import type { CaptionAppearance, CaptionCue } from './Cea608Encoder.ts';
import {
  captionLoadFrames,
  numpadFromLegacyAlignment,
} from './Cea608Encoder.ts';

/**
 * A program's captions, on its own clock: time 0 is the program's first output
 * frame (see {@link firstFrameMs}).
 */
export type ProgramCaptions = {
  cues: CaptionCue[];
  // Exact output frame rate; the caption schedule is laid out on this grid
  frameRate: number;
  durationMs: number;
  // ISO 639-2
  language: string;
  // How they look: the global caption settings with the program's channel's
  // own over them, resolved when the program starts (channelCaptions.ts).
  // Unset = the global settings at the time the captions are laid out.
  appearance?: Partial<CaptionAppearance>;
};

// "01:02:03,456", "01:02:03.456", "02:03.456" (WebVTT), "1:02:03.45" (ASS)
function parseTimestamp(text: string): number | undefined {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(
    text.trim(),
  );
  if (!match) {
    return;
  }
  const [, h, m, s, frac] = match;
  const fraction = Number((frac ?? '0').padEnd(3, '0'));
  return ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + fraction;
}

// SRT and WebVTT: a "start --> end" line, then text lines until a blank line
function parseSrtOrVtt(text: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const timing = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[i] ?? '');
    if (!timing) {
      continue;
    }
    const startMs = parseTimestamp(timing[1] ?? '');
    const endMs = parseTimestamp(timing[2] ?? '');
    const body: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== '') {
      i++;
      body.push(lines[i] ?? '');
    }
    if (startMs !== undefined && endMs !== undefined && endMs > startMs) {
      cues.push({ startMs, endMs, text: body.join('\n') });
    }
  }
  return cues;
}

// ASS/SSA script size when the script gives neither PlayResX nor PlayResY, as
// libass has it
const DefaultPlayRes = { x: 384, y: 288 };

// The script size libass uses when only one of PlayResX/PlayResY is given
function playRes(x: number | undefined, y: number | undefined) {
  if (x === undefined && y === undefined) {
    return { playResX: DefaultPlayRes.x, playResY: DefaultPlayRes.y };
  }
  if (y === undefined) {
    const width = x ?? DefaultPlayRes.x;
    return {
      playResX: width,
      playResY: width === 1280 ? 1024 : Math.max(1, (width * 3) / 4),
    };
  }
  if (x === undefined) {
    return {
      playResX: y === 1024 ? 1280 : Math.max(1, (y * 4) / 3),
      playResY: y,
    };
  }
  return { playResX: x, playResY: y };
}

// "Key: value" lines, as ASS sections are written
function keyValue(line: string): [string, string] | undefined {
  const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
  return match
    ? [match[1]?.trim().toLowerCase() ?? '', match[2] ?? '']
    : undefined;
}

const DefaultEventFields = [
  'layer',
  'start',
  'end',
  'style',
  'name',
  'marginl',
  'marginr',
  'marginv',
  'effect',
  'text',
];

// ASS/SSA: the "Dialogue:" lines of [Events], fields per its Format line, with
// what placing them needs: the script's size ([Script Info] PlayResX and
// PlayResY) and each style's alignment ([V4+ Styles], or [V4 Styles] in SSA's
// numbering). Layered copies of a line (the same text at the same times, as
// typesetting stacks for outlines and glows) are kept once; the same text in another
// place (another style's alignment) is a line of its own.
function parseAss(text: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let section = '';
  let eventFields = DefaultEventFields;
  let styleFields: string[] | undefined;
  const styleAlignments = new Map<string, number>();
  let resX: number | undefined;
  let resY: number | undefined;
  const events: {
    startMs: number;
    endMs: number;
    text: string;
    style: string;
  }[] = [];

  for (const line of text.replace(/\r/g, '').split('\n')) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line);
    if (header) {
      section = header[1]?.trim().toLowerCase() ?? '';
      continue;
    }
    const entry = keyValue(line);
    if (!entry) {
      continue;
    }
    const [key, value] = entry;
    if (section === 'script info') {
      const n = Number(value.trim());
      if (key === 'playresx' && n > 0) {
        resX = n;
      } else if (key === 'playresy' && n > 0) {
        resY = n;
      }
    } else if (section === 'v4+ styles' || section === 'v4 styles') {
      if (key === 'format') {
        styleFields = value.split(',').map((f) => f.trim().toLowerCase());
      } else if (key === 'style' && styleFields) {
        const values = value.split(',');
        const name = values[styleFields.indexOf('name')]?.trim();
        const alignment = Number(values[styleFields.indexOf('alignment')]);
        const numpad =
          section === 'v4 styles'
            ? numpadFromLegacyAlignment(alignment)
            : alignment;
        if (name !== undefined && numpad !== undefined) {
          styleAlignments.set(name.replace(/^\*/, ''), numpad);
        }
      }
    } else if (key === 'format' && /text/i.test(value)) {
      eventFields = value.split(',').map((f) => f.trim().toLowerCase());
    } else if (key === 'dialogue') {
      // The text field is last and may itself contain commas
      const values = value.split(',');
      const textValue = values.splice(eventFields.length - 1).join(',');
      const field = (name: string) => values[eventFields.indexOf(name)] ?? '';
      const startMs = parseTimestamp(field('start'));
      const endMs = parseTimestamp(field('end'));
      if (startMs !== undefined && endMs !== undefined && endMs > startMs) {
        events.push({
          startMs,
          endMs,
          text: textValue,
          style: field('style').trim().replace(/^\*/, ''),
        });
      }
    }
  }

  const size = playRes(resX, resY);
  const seen = new Set<string>();
  for (const event of events) {
    // An unknown style is drawn in Default, as libass does
    const styleAlignment =
      styleAlignments.get(event.style) ?? styleAlignments.get('Default');
    // The same text at the same times and place is a layered copy; in another
    // place (another style's alignment) it is a line of its own
    const key = `${event.startMs}|${event.endMs}|${styleAlignment}|${event.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cues.push({
      startMs: event.startMs,
      endMs: event.endMs,
      text: event.text,
      ass: { ...size, styleAlignment },
    });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

export function parseSubtitleCues(
  text: string,
  codec: string,
): CaptionCue[] | undefined {
  switch (codec.toLowerCase()) {
    case 'srt':
    case 'subrip':
    case 'mov_text':
    case 'webvtt':
    case 'vtt':
      return parseSrtOrVtt(text);
    case 'ass':
    case 'ssa':
      return parseAss(text);
    default:
      return;
  }
}

type LanguagePreference = { iso6391: string; iso6392: string };

/**
 * The tracks to caption from when the selected one can't be used, best first:
 * full (not forced) text tracks in the preferred languages' order, regular
 * before SDH. A track may still need its file found (an embedded track's
 * extracted copy in the subtitle cache).
 */
export function captionTrackCandidates(
  subtitles: SubtitleStreamDetails[],
  languages: readonly LanguagePreference[],
): SubtitleStreamDetails[] {
  const usable = subtitles.filter(
    (s) => !s.forced && !isImageBasedSubtitle(s.codec),
  );
  return languages.flatMap((language) => {
    const matching = usable.filter(
      (s) =>
        s.languageCodeISO6392 === language.iso6392 ||
        s.languageCodeISO6391 === language.iso6391,
    );
    return [
      ...matching.filter((s) => !s.sdh),
      ...matching.filter((s) => s.sdh),
    ];
  });
}

/**
 * Where a program's first output frame is in its source: the first frame at
 * or after the seek, since ffmpeg drops the frames before it. Timing cues from
 * the seek itself put them up to a frame late. Assumes the source's frames
 * sit on its frame rate's grid from the start, as constant-rate video does.
 */
export function firstFrameMs(seekMs: number, frameRate: number): number {
  if (seekMs <= 0) {
    return 0;
  }
  const frameMs = 1000 / frameRate;
  // A seek onto a frame keeps that frame; allow for floating-point error
  return Math.ceil(seekMs / frameMs - 1e-6) * frameMs;
}

/**
 * Reads a subtitle track's cues and puts them on the program's clock: the cue
 * times minus the first frame's time, keeping only those that overlap the
 * program.
 */
export async function loadProgramCaptions(
  track: SubtitleStreamDetails,
  program: { seekMs: number; durationMs: number; frameRate: number },
): Promise<ProgramCaptions | undefined> {
  if (track.path === undefined) {
    return;
  }
  const cues = parseSubtitleCues(
    await fs.readFile(track.path, 'utf-8'),
    track.codec,
  );
  if (!cues) {
    return;
  }
  const startMs = firstFrameMs(program.seekMs, program.frameRate);
  return {
    cues: cues
      .map((cue) => ({
        ...cue,
        startMs: cue.startMs - startMs,
        endMs: cue.endMs - startMs,
      }))
      .filter((cue) => cue.endMs > 0 && cue.startMs < program.durationMs),
    frameRate: program.frameRate,
    durationMs: program.durationMs,
    language: track.languageCodeISO6392 ?? 'eng',
  };
}

// What a program without subtitles shows when its stream starts. Plex offers
// the CC option for the whole session, so without it a viewer who turns
// captions on sees nothing and can't tell whether they work.
export const NoCaptionsNoticeText = 'No captions for this program';

// The notice appears 1 s into the program's stream and stays up for 4 s.
// - 4 s: its five words take about 2 s to read at the 160-180 words a minute
//   captions are usually timed for. Twice that gives a viewer time to notice
//   it as well as read it, and it is gone before the program is under way.
// - 1 s in: a pop-on caption is loaded in the frames before it appears (17
//   frames here, 0.7 s at 23.976 fps), and those have to come after the
//   stream's first frame. The rest is margin for a program whose video starts
//   a couple of frames late, as a session's first program did before it
//   started at SessionStartPts (the encoder's B-frame delay): caption data
//   placed before its first frame is never sent.
export const NoCaptionsNoticeStartMs = 1000;
export const NoCaptionsNoticeMs = 4000;

// At a low frame rate 1 s is too few frames for that: loading takes up to 18
// frames (17 with block-centred lines, 18 with each line centred), plus 2 for
// a late start. So the notice starts no earlier than this many frames in, 3
// to spare: 1 s from 23.976 fps up, about 1.5 s at 15 fps.
export const NoCaptionsNoticeLeadFrames = 23;
// A box, a colour or narrower lines make the load longer; then the notice
// waits for it, with the same 5 frames to spare
const NoCaptionsNoticeSpareFrames = 5;

// When the notice appears, for a stream at `frameRate`, in `appearance`
export function noCaptionsNoticeStartMs(
  frameRate: number,
  appearance?: Partial<CaptionAppearance>,
): number {
  const leadFrames = Math.max(
    NoCaptionsNoticeLeadFrames,
    captionLoadFrames(NoCaptionsNoticeText, appearance) +
      NoCaptionsNoticeSpareFrames,
  );
  return Math.max(
    NoCaptionsNoticeStartMs,
    Math.ceil((leadFrames / frameRate) * 1000),
  );
}

/**
 * The captions for a program that has no subtitles: the notice, near the
 * start of its clock. That is the program's start, or the tune-in point when
 * the stream starts partway through it.
 *
 * - Only scheduled programs get it: lineup items of type 'program', which
 *   include custom show episodes and what a redirect resolves to. Filler
 *   ('commercial': filler lists, in flex time or scheduled in slots) and a
 *   flex gap's fallback filler ('fallback') get none. Offline and error items
 *   never reach here; they play placeholder streams, which carry no captions.
 * - Music tracks get none either: there is no speech to caption, and a music
 *   channel would show it at every song.
 * - No subtitles means no subtitle track at all. A program with any track,
 *   even one that can't become captions (image-based, forced only, another
 *   language), is left as it is.
 * - It needs the frame rate captions are laid out on, as subtitles do.
 * - A stream shorter than 8 s, twice the notice (a bumper, or the last seconds
 *   of a program at tune-in), gets none: the notice would cover most of it,
 *   and the code that clears it has to fall inside the program, since nothing
 *   of a program's schedule is sent past its end.
 */
export function noCaptionsNotice(
  item: StreamLineupItem,
  stream: {
    subtitles: readonly SubtitleStreamDetails[];
    durationMs: number;
    frameRate: number | undefined;
    // ISO 639-2, the language the stream labels its captions with
    language: string;
    // How the captions will look, which decides how long the notice takes
    // to load
    appearance?: Partial<CaptionAppearance>;
  },
): ProgramCaptions | undefined {
  if (
    item.type !== 'program' ||
    item.program.type === 'track' ||
    stream.subtitles.length > 0 ||
    stream.frameRate === undefined
  ) {
    return;
  }
  const startMs = noCaptionsNoticeStartMs(stream.frameRate, stream.appearance);
  // The clearing code needs a second of program after it, too
  if (
    stream.durationMs < 2 * NoCaptionsNoticeMs ||
    stream.durationMs < startMs + NoCaptionsNoticeMs + 1000
  ) {
    return;
  }
  return {
    cues: [
      {
        startMs,
        endMs: startMs + NoCaptionsNoticeMs,
        text: NoCaptionsNoticeText,
      },
    ],
    frameRate: stream.frameRate,
    durationMs: stream.durationMs,
    language: stream.language,
  };
}

// Marks a media playlist's segment URIs so their requests come back captioned
export function markSegmentsForCaptions(playlist: string): string {
  return playlist
    .split('\n')
    .map((line) =>
      line.length > 0 && !line.startsWith('#') && /\.ts$/.test(line.trim())
        ? `${line.trim()}?captions=1`
        : line,
    )
    .join('\n');
}
