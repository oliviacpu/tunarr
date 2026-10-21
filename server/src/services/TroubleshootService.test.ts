import type { GlobalSubtitlePreference } from '@tunarr/types/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBackedStreamLineupItem } from '../db/derived_types/StreamLineup.ts';
import { SubtitleStreamPicker } from '../ffmpeg/SubtitleStreamPicker.ts';
import type { SubtitleStreamDetails } from '../stream/types.ts';
import {
  describeSubtitleAction,
  findSubtitleForLanguages,
  resolveSubtitlePreferenceTrace,
} from './TroubleshootService.ts';

function makeSubtitle(
  index: number,
  languageCodeISO6392: string,
): SubtitleStreamDetails {
  return {
    type: 'embedded',
    codec: 'subrip',
    index,
    default: false,
    forced: false,
    sdh: false,
    languageCodeISO6392,
  };
}

// The troubleshoot report is the tool users copy into bug reports, so its
// subtitle matching has to agree with what playback actually picks. It used to
// compare codes as raw strings while the stream selector normalized them.
// Regression test for https://github.com/chrisbenincasa/tunarr/issues/1960
describe('findSubtitleForLanguages', () => {
  it('matches a bibliographic request against a terminological stream', () => {
    const match = findSubtitleForLanguages(
      [makeSubtitle(1, 'deu'), makeSubtitle(2, 'eng')],
      ['ger'],
    );

    expect(match?.stream.index).toBe(1);
    expect(match?.language).toBe('ger');
  });

  it('matches a terminological request against a bibliographic stream', () => {
    const match = findSubtitleForLanguages(
      [makeSubtitle(1, 'ger'), makeSubtitle(2, 'eng')],
      ['deu'],
    );

    expect(match?.stream.index).toBe(1);
  });

  it('honors request order', () => {
    const match = findSubtitleForLanguages(
      [makeSubtitle(1, 'deu'), makeSubtitle(2, 'eng')],
      ['eng', 'ger'],
    );

    expect(match?.stream.index).toBe(2);
    expect(match?.language).toBe('eng');
  });

  it('returns undefined when nothing matches', () => {
    expect(
      findSubtitleForLanguages([makeSubtitle(1, 'eng')], ['ger']),
    ).toBeUndefined();
  });

  it('returns undefined when there are no subtitle streams', () => {
    expect(findSubtitleForLanguages(undefined, ['ger'])).toBeUndefined();
    expect(findSubtitleForLanguages([], ['ger'])).toBeUndefined();
  });
});

describe('inherited subtitle troubleshooting', () => {
  const lineupItem = {
    type: 'program',
    streamDuration: 30000,
    programBeginMs: 0,
    duration: 30000,
    infiniteLoop: false,
    program: {
      uuid: 'program-uuid',
      externalKey: 'external-key',
      mediaSourceId: 'media-source',
      sourceType: 'plex',
      externalIds: [],
    },
  } as ContentBackedStreamLineupItem;

  function preference(
    languageCode: string,
    overrides: Partial<GlobalSubtitlePreference> = {},
  ): GlobalSubtitlePreference {
    return {
      languageCode,
      filter: 'any',
      allowExternal: true,
      allowImageBased: true,
      ...overrides,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('describes each preference in order with its own filter and flags', () => {
    expect(
      describeSubtitleAction({
        type: 'by_preferences',
        preferences: [
          preference('eng', {
            filter: 'forced',
            allowExternal: false,
            allowImageBased: false,
          }),
          preference('deu', { filter: 'none' }),
        ],
      }),
    ).toBe(
      'Select subtitles by ordered preferences: [eng (filter: forced, external: disabled, image-based: disabled); deu (filter: none, external: allowed, image-based: allowed)]',
    );
  });

  it("reports a later language using that row's flags and language aliases", async () => {
    const externalEnglish = {
      ...makeSubtitle(1, 'eng'),
      type: 'external' as const,
    };
    const externalGerman = {
      ...makeSubtitle(2, 'ger'),
      type: 'external' as const,
      forced: true,
    };
    const result = await resolveSubtitlePreferenceTrace(
      [
        preference('eng', { allowExternal: false }),
        preference('deu', { filter: 'forced' }),
      ],
      [externalEnglish, externalGerman],
      lineupItem,
      true,
    );

    expect(result).toEqual({
      stream: externalGerman,
      reason: 'Matched subtitle preference',
    });
  });

  it('skips an unavailable embedded extraction and reports the next usable row', async () => {
    const extracted = vi
      .spyOn(SubtitleStreamPicker, 'getSubtitleDetailsWithExtractedPath')
      .mockResolvedValue(undefined);
    const english = makeSubtitle(1, 'eng');
    const german = {
      ...makeSubtitle(2, 'deu'),
      type: 'external' as const,
    };
    const result = await resolveSubtitlePreferenceTrace(
      [preference('eng'), preference('deu')],
      [english, german],
      lineupItem,
      true,
    );

    expect(extracted).toHaveBeenCalledWith(lineupItem, english);
    expect(result.stream).toBe(german);
  });

  it('does not report an image track when that row excludes images', async () => {
    const image = { ...makeSubtitle(1, 'eng'), codec: 'hdmv_pgs_subtitle' };
    const external = { ...makeSubtitle(2, 'deu'), type: 'external' as const };
    const result = await resolveSubtitlePreferenceTrace(
      [preference('eng', { allowImageBased: false }), preference('deu')],
      [image, external],
      lineupItem,
      true,
    );

    expect(result.stream).toBe(external);
  });

  it.each([[preference('eng', { filter: 'none' })], [preference('deu')]])(
    'reports no selection for inactive or unmatched preferences: %j',
    async (row) => {
      const result = await resolveSubtitlePreferenceTrace(
        [row],
        [{ ...makeSubtitle(1, 'eng'), type: 'external' }],
        lineupItem,
        true,
      );

      expect(result).toEqual({
        stream: null,
        reason: 'No available subtitle matched preferences',
      });
    },
  );

  it('reports disabled subtitles without attempting extraction', async () => {
    const extracted = vi.spyOn(
      SubtitleStreamPicker,
      'getSubtitleDetailsWithExtractedPath',
    );
    const result = await resolveSubtitlePreferenceTrace(
      [preference('eng')],
      [makeSubtitle(1, 'eng')],
      lineupItem,
      false,
    );

    expect(result).toEqual({
      stream: null,
      reason: 'Subtitles disabled for channel',
    });
    expect(extracted).not.toHaveBeenCalled();
  });

  it.each([undefined, []])(
    'reports no selection without subtitle streams: %j',
    async (streams) => {
      const result = await resolveSubtitlePreferenceTrace(
        [preference('eng')],
        streams,
        lineupItem,
        true,
      );

      expect(result.stream).toBeNull();
    },
  );
});
