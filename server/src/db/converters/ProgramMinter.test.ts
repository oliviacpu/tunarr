import type { Episode, MediaStream } from '@tunarr/types';
import { describe, expect, it } from 'vitest';
import { LanguageService } from '@/services/LanguageService.js';
import { ProgramDaoMinter } from './ProgramMinter.ts';

// A DVD rip of an English-dubbed anime: signs-and-songs and full subtitles, each
// as image and text tracks, the text signs-and-songs track default and forced
function dvdRipEpisode(streams: MediaStream[]): Episode {
  return {
    uuid: '00000000-0000-0000-0000-000000000001',
    sourceType: 'plex',
    identifiers: [],
    title: "Can't Buy a Thrill",
    sortTitle: "Can't Buy a Thrill",
    tags: [],
    artwork: [],
    originalTitle: null,
    year: null,
    releaseDate: null,
    releaseDateString: null,
    state: 'ok',
    type: 'episode',
    episodeNumber: 1,
    summary: null,
    duration: 1_477_000,
    mediaSourceId: 'source-1',
    libraryId: 'library-1',
    canonicalId: 'canonical-1',
    externalId: 'external-1',
    mediaItem: {
      streams,
      duration: 1_477_000,
      frameRate: '60000/1001',
      resolution: { widthPx: 720, heightPx: 480 },
      locations: [{ type: 'local', path: '/media/tv/episode.mkv' }],
    },
  };
}

const dvdRipStreams: MediaStream[] = [
  { index: 0, codec: 'hevc', streamType: 'video' },
  { index: 1, codec: 'ac3', streamType: 'audio', languageCodeISO6392: 'eng' },
  { index: 2, codec: 'ac3', streamType: 'audio', languageCodeISO6392: 'jpn' },
  {
    index: 3,
    codec: 'vobsub',
    streamType: 'subtitles',
    title: 'Signs & Songs',
    languageCodeISO6392: 'eng',
  },
  {
    index: 4,
    codec: 'vobsub',
    streamType: 'subtitles',
    title: 'Full',
    languageCodeISO6392: 'eng',
  },
  {
    index: 5,
    codec: 'srt',
    streamType: 'subtitles',
    title: 'Signs & Songs (OCR)',
    languageCodeISO6392: 'eng',
    default: true,
    forced: true,
  },
  {
    index: 6,
    codec: 'srt',
    streamType: 'subtitles',
    title: 'Full (OCR)',
    languageCodeISO6392: 'eng',
  },
];

describe('ProgramDaoMinter.mintVersions', () => {
  // Stream selection reads subtitles from these rows: a forced flag lost here
  // made a forced-only rule find nothing to burn in, and the caption fallback
  // took the sparse forced track for the full one
  it('keeps each stream forced flag', () => {
    const [version] = new ProgramDaoMinter().mintVersions(
      'program-1',
      dvdRipEpisode(dvdRipStreams),
    );
    expect(
      version?.mediaStreams.map((stream) => [stream.index, stream.forced]),
    ).toEqual([
      [0, false],
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, true],
      [6, false],
    ]);
  });

  it('records a stream with no forced flag as not forced', () => {
    const [version] = new ProgramDaoMinter().mintVersions(
      'program-1',
      dvdRipEpisode([{ index: 0, codec: 'srt', streamType: 'subtitles' }]),
    );
    expect(version?.mediaStreams[0]?.forced).toBe(false);
  });
});

// The ISO 639-2 /B→/T normalization that keeps stored language codes in one
// canonical set. Regression coverage for #2044: a provider's bibliographic
// code must turn into the terminological code Tunarr stores elsewhere
// (FfprobeStreamDetails / LocalSubtitlesService already write /T), and an
// unresolvable value must be kept as-is rather than dropped.
describe('LanguageService.normalizeLanguageCode (#2044)', () => {
  it.each([
    // /B → /T (the reported class: German 'ger' vs 'deu')
    ['ger', 'deu'],
    ['fre', 'fra'],
    ['dut', 'nld'],
    ['chi', 'zho'],
  ])('maps ISO 639-2/B "%s" to its /T equivalent "%s"', (input, expected) => {
    expect(LanguageService.normalizeLanguageCode(input)).toBe(expected);
  });

  it.each(['deu', 'fra', 'nld', 'por', 'jpn', 'eng'])(
    'keeps an already-/T code "%s" unchanged',
    (input) => {
      expect(LanguageService.normalizeLanguageCode(input)).toBe(input);
    },
  );

  it.each(['de', 'fr', 'nl', 'pt', 'ja'])(
    'maps a 2-letter code "%s" to its /T code',
    (input) => {
      const out = LanguageService.normalizeLanguageCode(input);
      expect(out).toBeDefined();
      expect(out).toHaveLength(3);
    },
  );

  it('maps an English language name to its /T code', () => {
    expect(LanguageService.normalizeLanguageCode('japanese')).toBe('jpn');
    expect(LanguageService.normalizeLanguageCode('German')).toBe('deu');
  });

  it.each(['unknown', 'xxyy', 'abc123'])(
    'keeps an unresolvable value "%s" verbatim (incl. the subtitle sentinel)',
    (input) => {
      expect(LanguageService.normalizeLanguageCode(input)).toBe(input);
    },
  );

  it('passes through an empty or absent value', () => {
    expect(LanguageService.normalizeLanguageCode(undefined)).toBeUndefined();
    expect(LanguageService.normalizeLanguageCode('')).toBe('');
  });

  it('coerces a null code to undefined', () => {
    // Plex/Emby subtitle language fields are nullable; the function must not
    // blow up and must return undefined so callers can fall back to their
    // default (e.g. ?? 'unknown').
    expect(LanguageService.normalizeLanguageCode(null)).toBeUndefined();
  });
});
