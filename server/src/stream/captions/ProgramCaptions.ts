import fs from 'node:fs/promises';
import type { StreamLineupItem } from '../../db/derived_types/StreamLineup.ts';
import { isImageBasedSubtitle } from '../util.ts';
import type { SubtitleStreamDetails } from '../types.ts';
import type { CaptionCue } from './Cea608Encoder.ts';

/**
 * A program's captions, on its own clock: time 0 is the program's first output
 * frame (the source position Tunarr seeked to).
 */
export type ProgramCaptions = {
  cues: CaptionCue[];
  // Exact output frame rate; the caption schedule is laid out on this grid
  frameRate: number;
  durationMs: number;
  // ISO 639-2
  language: string;
};

// A frame rate as frames per second, exact for the NTSC rates (24000/1001...)
// that probes and settings round. A rounded rate drifts captions by about one
// frame a minute. Undefined when missing or implausible.
export function exactFrameRate(
  framerate: number | string | null | undefined,
): number | undefined {
  let rate: number;
  if (typeof framerate === 'number') {
    rate = framerate;
  } else if (typeof framerate === 'string' && framerate.includes('/')) {
    const [num, den] = framerate.split('/').map(Number);
    rate = num !== undefined && den !== undefined ? num / den : NaN;
    if (Number.isFinite(rate) && rate > 0 && rate <= 240) {
      return rate;
    }
  } else {
    rate = parseFloat(framerate ?? '');
  }
  if (!Number.isFinite(rate) || rate <= 0 || rate > 240) {
    return;
  }
  const ntsc = (Math.round((rate * 1001) / 1000) * 1000) / 1001;
  return Math.abs(rate - ntsc) < 0.005 && !Number.isInteger(rate) ? ntsc : rate;
}

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

// ASS/SSA: "Dialogue:" lines in the [Events] section, fields per its Format line
function parseAss(text: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let fields = [
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
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const format = /^Format:\s*(.*)$/i.exec(line);
    if (format && /text/i.test(format[1] ?? '')) {
      fields = (format[1] ?? '').split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    const dialogue = /^Dialogue:\s*(.*)$/i.exec(line);
    if (!dialogue) {
      continue;
    }
    // The text field is last and may itself contain commas
    const values = (dialogue[1] ?? '').split(',');
    const textValue = values.splice(fields.length - 1).join(',');
    const field = (name: string) => values[fields.indexOf(name)] ?? '';
    const startMs = parseTimestamp(field('start'));
    const endMs = parseTimestamp(field('end'));
    if (startMs !== undefined && endMs !== undefined && endMs > startMs) {
      cues.push({ startMs, endMs, text: textValue });
    }
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
 * Reads a subtitle track's cues and puts them on the program's clock: the cue
 * times minus the seek, keeping only those that overlap the program.
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
  return {
    cues: cues
      .map((cue) => ({
        ...cue,
        startMs: cue.startMs - program.seekMs,
        endMs: cue.endMs - program.seekMs,
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
//   stream's first frames. A session's first program has no frames for the
//   first couple of slots of its schedule (its video starts after the
//   encoder's B-frame delay), so caption data placed there is never sent.
export const NoCaptionsNoticeStartMs = 1000;
export const NoCaptionsNoticeMs = 4000;

// At a low frame rate 1 s is too few frames for that: loading takes up to 18
// frames (17 with block-centred lines, 18 with each line centred), after the
// 2 a first program loses. So the notice starts no earlier than this many
// frames in, 3 to spare: 1 s from 23.976 fps up, about 1.5 s at 15 fps.
export const NoCaptionsNoticeLeadFrames = 23;

// When the notice appears, for a stream at `frameRate`
export function noCaptionsNoticeStartMs(frameRate: number): number {
  return Math.max(
    NoCaptionsNoticeStartMs,
    Math.ceil((NoCaptionsNoticeLeadFrames / frameRate) * 1000),
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
  const startMs = noCaptionsNoticeStartMs(stream.frameRate);
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
