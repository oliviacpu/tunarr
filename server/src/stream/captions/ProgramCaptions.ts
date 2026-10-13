import fs from 'node:fs/promises';
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
 * The subtitle track to caption from when the selected one can't be used:
 * a full (not forced) text track with a file on disk, in the first preferred
 * language that has one, regular before SDH.
 */
export function pickCaptionTrack(
  subtitles: SubtitleStreamDetails[],
  languages: readonly LanguagePreference[],
): SubtitleStreamDetails | undefined {
  const usable = subtitles.filter(
    (s) => !s.forced && !isImageBasedSubtitle(s.codec) && s.path !== undefined,
  );
  for (const language of languages) {
    const matching = usable.filter(
      (s) =>
        s.languageCodeISO6392 === language.iso6392 ||
        s.languageCodeISO6391 === language.iso6391,
    );
    const pick = matching.find((s) => !s.sdh) ?? matching[0];
    if (pick) {
      return pick;
    }
  }
  return;
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
