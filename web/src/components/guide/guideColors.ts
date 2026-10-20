import type { Palette } from '@mui/material';
import type { TvGuideProgram } from '@tunarr/types';
import Color from 'colorjs.io';
import { extractProgramGrandparent } from '../../helpers/programUtil.ts';

// Guide cell colours. Every value is a pure function of the active palette, so
// the guide follows the theme and the light/dark scheme.
//
// Programs are tinted from an 8-step categorical ramp: muted fills behind text,
// keyed by show (or movie) so the same show keeps its colour across reloads.
// The fill is a grouping aid, not the identity channel: every cell prints its
// title, neighbours are separated by a gap, and the program type is carried by
// shape and glyph (dashed outline for flex, an arrow for redirects), so nothing
// depends on telling two tints apart.

export const GuideRampSteps = 8;

// OKLCH lightness and chroma per scheme. Light mode uses tints and dark mode
// uses shades, both chosen so text.primary stays well above 4.5:1 on every
// step (guideColors.test.ts checks this).
const RampTone = {
  light: { lightness: 0.9, chroma: 0.05, hoverShift: -0.04 },
  dark: { lightness: 0.36, chroma: 0.05, hoverShift: 0.04 },
} as const;

// The steps sit between the brand hue's neighbours, never on it, so no
// program reads as the accent. Only the now-playing cell and the time marker
// use primary.
const HueOffsetFromPrimary = 360 / GuideRampSteps / 2;

// Redirect cells are the secondary colour at this alpha over the paper.
const RedirectAlpha = 0.16;

export type GuideCellType = 'content' | 'flex' | 'redirect';

export type GuideCellStyle = {
  background: string;
  hoverBackground: string;
  color: string;
  /** A dashed outline drawn inside the cell, for gaps in the schedule. */
  outline: string | undefined;
  /** A leading glyph that names the type without relying on colour. */
  glyph: 'redirect' | undefined;
};

const toHex = (color: Color) =>
  color
    .toGamut({ space: 'srgb' })
    .to('srgb')
    .toString({ format: 'hex', collapse: false });

function primaryHue(palette: Palette): number {
  const [, , hue] = new Color(palette.primary.main).to('oklch').coords;
  // An achromatic primary has no hue; start the wheel at red.
  return Number.isFinite(hue) ? hue : 0;
}

function rampColors(palette: Palette, shift: number): string[] {
  const tone = RampTone[palette.mode];
  const start = primaryHue(palette) + HueOffsetFromPrimary;
  return Array.from({ length: GuideRampSteps }, (_, step) =>
    toHex(
      new Color('oklch', [
        tone.lightness + shift,
        tone.chroma,
        (start + (step * 360) / GuideRampSteps) % 360,
      ]),
    ),
  );
}

type RampCache = { ramp: string[]; hover: string[] };
const rampCache = new WeakMap<Palette, RampCache>();

function cachedRamps(palette: Palette): RampCache {
  const cached = rampCache.get(palette);
  if (cached !== undefined) {
    return cached;
  }
  const ramps = {
    ramp: rampColors(palette, 0),
    hover: rampColors(palette, RampTone[palette.mode].hoverShift),
  };
  rampCache.set(palette, ramps);
  return ramps;
}

/** The 8 program fills for this palette, as #rrggbb. */
export function guideRamp(palette: Palette): readonly string[] {
  return cachedRamps(palette).ramp;
}

/** The hover fill for each ramp step, in the same order as guideRamp. */
export function guideHoverRamp(palette: Palette): readonly string[] {
  return cachedRamps(palette).hover;
}

/**
 * The ramp step for a key: 32-bit FNV-1a over the key's UTF-16 code units, so
 * a key maps to the same step on every load and in every browser.
 */
export function rampStep(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % GuideRampSteps;
}

/** The fill for the program identified by key (see guideColorKey). */
export function programColor(palette: Palette, key: string): string {
  return guideRamp(palette)[rampStep(key)];
}

const blend = (foreground: string, alpha: number, background: string) =>
  toHex(
    new Color(background).mix(foreground, alpha, {
      space: 'srgb',
      outputSpace: 'srgb',
    }),
  );

/**
 * The cell style for a program type. Content cells take the ramp step for
 * key; flex gaps recede to the page background with a dashed divider; redirects
 * are a light wash of the secondary colour with an arrow glyph.
 */
export function typeStyle(
  palette: Palette,
  type: GuideCellType,
  key: string = '',
): GuideCellStyle {
  switch (type) {
    case 'content': {
      const step = rampStep(key);
      return {
        background: guideRamp(palette)[step],
        hoverBackground: guideHoverRamp(palette)[step],
        color: palette.text.primary,
        outline: undefined,
        glyph: undefined,
      };
    }
    case 'flex':
      return {
        background: palette.background.default,
        hoverBackground: palette.background.default,
        color: palette.text.secondary,
        outline: `1px dashed ${palette.divider}`,
        glyph: undefined,
      };
    case 'redirect':
      return {
        background: blend(
          palette.secondary.main,
          RedirectAlpha,
          palette.background.paper,
        ),
        hoverBackground: blend(
          palette.secondary.main,
          RedirectAlpha * 1.5,
          palette.background.paper,
        ),
        color: palette.text.primary,
        outline: undefined,
        glyph: 'redirect',
      };
  }
}

export function guideCellType(program: TvGuideProgram): GuideCellType {
  switch (program.type) {
    case 'content':
    case 'custom':
      return 'content';
    case 'flex':
      return 'flex';
    case 'redirect':
      return 'redirect';
  }
}

/**
 * What a program's colour follows: the show for episodes (the artist for
 * tracks), the program itself for movies and other videos. Custom-show
 * entries follow the program they wrap.
 */
export function guideColorKey(program: TvGuideProgram): string {
  switch (program.type) {
    case 'content': {
      const grandparent = extractProgramGrandparent(program.program);
      return grandparent !== undefined
        ? `${grandparent.type}.${grandparent.uuid}`
        : `program.${program.id}`;
    }
    case 'custom': {
      const inner = program.program;
      if (inner === undefined) {
        return `custom.${program.customShowId}`;
      }
      const grandparent = extractProgramGrandparent(inner.program);
      return grandparent !== undefined
        ? `${grandparent.type}.${grandparent.uuid}`
        : `program.${program.id}`;
    }
    case 'flex':
      return 'flex';
    case 'redirect':
      return `redirect.${program.channel}`;
  }
}
