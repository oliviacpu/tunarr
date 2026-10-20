import type { TvGuideProgram } from '@tunarr/types';
import Color from 'colorjs.io';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  type Scheme,
  schemePalette,
} from '../../test/contrast.ts';
import {
  makeContentProgram,
  makeEpisode,
  makeMovie,
  makeShowGrouping,
} from '../../test/programFixtures.ts';
import {
  GuideRampSteps,
  guideCellType,
  guideColorKey,
  guideHoverRamp,
  guideRamp,
  programColor,
  isProgramCell,
  rampStep,
  typeStyle,
  channelProgramStyle,
} from './guideColors.ts';

const schemes: Scheme[] = ['light', 'dark'];

const hue = (color: string) => new Color(color).to('oklch').coords[2];

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const guideProgram = (
  program: ReturnType<typeof makeContentProgram>,
): TvGuideProgram => ({ ...program, start: 0, stop: 1000, isPaused: false });

describe('channelProgramStyle', () => {
  it.each(schemes)(
    'shares guide colours and show grouping with lineup/calendar entries in %s',
    (scheme) => {
      const palette = schemePalette(scheme);
      const show = makeShowGrouping('shared-show');
      const first = makeContentProgram(
        makeEpisode({ uuid: 'ep-1', show }),
        1000,
      );
      const second = makeContentProgram(
        makeEpisode({ uuid: 'ep-2', show }),
        1000,
      );
      const custom = {
        type: 'custom',
        id: first.id,
        customShowId: 'custom-1',
        index: 0,
        duration: 1000,
        program: first,
      } as const;
      const expected = typeStyle(
        palette,
        'episode',
        guideColorKey(guideProgram(first)),
      );
      expect(channelProgramStyle(palette, first)).toEqual(expected);
      expect(channelProgramStyle(palette, second)).toEqual(expected);
      expect(channelProgramStyle(palette, custom)).toEqual(expected);
      expect(
        channelProgramStyle(palette, { type: 'flex', duration: 1000 }),
      ).toEqual(typeStyle(palette, 'flex'));
      expect(
        channelProgramStyle(palette, {
          type: 'redirect',
          channel: 'channel-1',
          channelNumber: 1,
          channelName: 'Test channel',
          duration: 1000,
        }),
      ).toEqual(typeStyle(palette, 'redirect'));
      expect(
        channelProgramStyle(palette, {
          type: 'filler',
          id: 'id-1',
          fillerListId: 'list-1',
          fillerType: 'mid',
          duration: 1000,
        }),
      ).toEqual(typeStyle(palette, 'content', 'filler.list-1'));
    },
  );
});

describe('guideRamp', () => {
  it.each(schemes)('has %s distinct steps in the %s scheme', (scheme) => {
    const ramp = guideRamp(schemePalette(scheme));
    expect(ramp).toHaveLength(GuideRampSteps);
    expect(GuideRampSteps).toBe(8);
    expect(new Set(ramp).size).toBe(8);
    for (const step of ramp) {
      expect(step).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('chooses its own steps for each scheme', () => {
    const light = guideRamp(schemePalette('light'));
    const dark = guideRamp(schemePalette('dark'));
    for (const step of light) {
      expect(dark).not.toContain(step);
    }
  });

  it.each(schemes)(
    'keeps text.primary at 4.5:1 or more on every %s step and its hover',
    (scheme) => {
      const palette = schemePalette(scheme);
      for (const step of [...guideRamp(palette), ...guideHoverRamp(palette)]) {
        const ratio = contrastRatio(palette.text.primary, step);
        expect(
          ratio,
          `${palette.text.primary} on ${step} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(schemes)(
    'keeps every %s step off the primary hue, which is the accent',
    (scheme) => {
      const palette = schemePalette(scheme);
      const primaryHue = hue(palette.primary.main);
      for (const step of guideRamp(palette)) {
        expect(hueDistance(hue(step), primaryHue)).toBeGreaterThan(15);
      }
    },
  );
});

describe('programColor', () => {
  const palette = schemePalette('light');

  it('maps the same key to the same step every time', () => {
    for (const key of ['show.a', 'show.b', 'program.42', 'artist.x']) {
      expect(programColor(palette, key)).toBe(programColor(palette, key));
      expect(programColor(palette, key)).toBe(
        guideRamp(palette)[rampStep(key)],
      );
    }
  });

  it('uses a fixed hash, so a show keeps its colour across reloads', () => {
    // FNV-1a 32-bit. If these change, every show changes colour.
    expect(rampStep('')).toBe(0x811c9dc5 % 8);
    expect(rampStep('a')).toBe(0xe40c292c % 8);
    expect(rampStep('foobar')).toBe(0xbf9cf968 % 8);
  });

  it('spreads keys over every step', () => {
    const steps = new Set(
      Array.from({ length: 200 }, (_, i) => rampStep(`show.${i}`)),
    );
    expect(steps.size).toBe(GuideRampSteps);
  });
});

describe('guideColorKey', () => {
  const show = makeShowGrouping('show-1');

  it('gives every episode of a show the same key', () => {
    const first = guideProgram(
      makeContentProgram(makeEpisode({ uuid: 'ep-1', show }), 1000),
    );
    const second = guideProgram(
      makeContentProgram(makeEpisode({ uuid: 'ep-2', show }), 1000),
    );
    expect(guideColorKey(first)).toBe('show.show-1');
    expect(guideColorKey(second)).toBe(guideColorKey(first));
  });

  it('gives each movie its own key', () => {
    const first = guideProgram(
      makeContentProgram(makeMovie({ uuid: 'movie-1' }), 1000),
    );
    const second = guideProgram(
      makeContentProgram(makeMovie({ uuid: 'movie-2' }), 1000),
    );
    expect(guideColorKey(first)).not.toBe(guideColorKey(second));
  });

  it('follows the wrapped program for custom-show entries', () => {
    const episode = makeContentProgram(makeEpisode({ show }), 1000);
    const custom: TvGuideProgram = {
      type: 'custom',
      id: episode.id,
      customShowId: 'custom-1',
      index: 0,
      duration: 1000,
      program: episode,
      start: 0,
      stop: 1000,
      isPaused: false,
    };
    expect(guideColorKey(custom)).toBe('show.show-1');
  });
});

describe('typeStyle', () => {
  it.each(schemes)(
    'sets flex and redirect cells apart from the %s ramp',
    (scheme) => {
      const palette = schemePalette(scheme);
      const ramp = guideRamp(palette);
      const flex = typeStyle(palette, 'flex');
      const redirect = typeStyle(palette, 'redirect');
      const content = typeStyle(palette, 'content', 'show.a');

      expect(ramp).not.toContain(flex.background);
      expect(ramp).not.toContain(redirect.background);
      expect(flex.background).not.toBe(redirect.background);

      // The type is also carried without colour.
      expect(flex.outline).toMatch(/dashed/);
      expect(redirect.glyph).toBe('redirect');
      expect(content.outline).toBeUndefined();
      expect(content.glyph).toBeUndefined();
      expect(content.background).toBe(programColor(palette, 'show.a'));
    },
  );

  it.each(schemes)('uses the %s theme tokens for flex gaps', (scheme) => {
    const palette = schemePalette(scheme);
    const flex = typeStyle(palette, 'flex');
    expect(flex.background).toBe(palette.background.default);
    expect(flex.color).toBe(palette.text.secondary);
    expect(flex.outline).toBe(`1px dashed ${palette.divider}`);
  });

  it.each(schemes)(
    'keeps text readable at 4.5:1 on %s flex and redirect cells',
    (scheme) => {
      const palette = schemePalette(scheme);
      for (const type of ['flex', 'redirect'] as const) {
        const style = typeStyle(palette, type);
        for (const background of [style.background, style.hoverBackground]) {
          expect(contrastRatio(style.color, background)).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
    },
  );
});

describe('guideCellType', () => {
  const show = makeShowGrouping('show-1');

  it('tells movies from episodes', () => {
    const movie = guideProgram(makeContentProgram(makeMovie(), 1000));
    const episode = guideProgram(
      makeContentProgram(makeEpisode({ show }), 1000),
    );
    expect(guideCellType(movie)).toBe('movie');
    expect(guideCellType(episode)).toBe('episode');
  });

  it('classifies a custom-show entry by the program it wraps', () => {
    const custom: TvGuideProgram = {
      type: 'custom',
      id: 'program-1',
      customShowId: 'custom-1',
      index: 0,
      duration: 1000,
      program: makeContentProgram(makeMovie(), 1000),
      start: 0,
      stop: 1000,
      isPaused: false,
    };
    expect(guideCellType(custom)).toBe('movie');
    expect(guideCellType({ ...custom, program: undefined })).toBe('content');
  });

  it('opens details only for programs', () => {
    for (const type of ['movie', 'episode', 'track', 'content'] as const) {
      expect(isProgramCell(type)).toBe(true);
    }
    expect(isProgramCell('flex')).toBe(false);
    expect(isProgramCell('redirect')).toBe(false);
  });
});

describe('typeStyle for program kinds', () => {
  const palette = schemePalette('light');

  it('gives movies and episodes the same ramp colour but different glyphs', () => {
    const movie = typeStyle(palette, 'movie', 'show.a');
    const episode = typeStyle(palette, 'episode', 'show.a');
    expect(movie.background).toBe(episode.background);
    expect(movie.background).toBe(programColor(palette, 'show.a'));
    expect(movie.glyph).toBe('movie');
    expect(episode.glyph).toBe('episode');
    expect(typeStyle(palette, 'track', 'artist.a').glyph).toBe('track');
  });

  it('draws no glyph when the kind is unknown', () => {
    expect(typeStyle(palette, 'content', 'show.a').glyph).toBeUndefined();
  });
});
