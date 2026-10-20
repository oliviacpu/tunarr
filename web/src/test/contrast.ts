import type { Palette, Theme as MuiTheme } from '@mui/material';
import { decomposeColor, hslToRgb } from '@mui/material/styles';
import { Theme } from '../theme.ts';

// Helpers for tests that check colour pairings against WCAG contrast.

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(color: string): Rgba {
  const parsed = decomposeColor(
    color.startsWith('hsl') ? hslToRgb(color) : color,
  );
  if (parsed.type !== 'rgb' && parsed.type !== 'rgba') {
    throw new Error(`Unsupported colour: ${color}`);
  }
  const [r, g, b, a = 1] = parsed.values;
  return { r, g, b, a };
}

// A translucent colour (MUI's text colours are black or white at an alpha)
// is seen blended over what is behind it.
function composite(foreground: Rgba, background: Rgba): Rgba {
  if (background.a !== 1) {
    throw new Error('The background colour must be opaque');
  }
  const mix = (fg: number, bg: number) =>
    fg * foreground.a + bg * (1 - foreground.a);
  return {
    r: mix(foreground.r, background.r),
    g: mix(foreground.g, background.g),
    b: mix(foreground.b, background.b),
    a: 1,
  };
}

// WCAG 2 relative luminance, with the sRGB transfer function's 0.04045 knee.
function relativeLuminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast of foreground (blended if translucent) on background. */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  const fg = composite(parseColor(foreground), bg);
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export type Scheme = 'light' | 'dark';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPalette = (value: unknown): value is Palette =>
  isRecord(value) &&
  isRecord(value['text']) &&
  isRecord(value['background']) &&
  isRecord(value['primary']);

/**
 * A scheme's finished palette. createTheme keeps each scheme's palette on the
 * theme; MUI only types `colorSchemes` when CSS variables are on, so narrow it
 * here.
 */
export function schemePalette(
  scheme: Scheme,
  theme: MuiTheme = Theme,
): Palette {
  const schemes = 'colorSchemes' in theme ? theme.colorSchemes : undefined;
  const system = isRecord(schemes) ? schemes[scheme] : undefined;
  const palette = isRecord(system) ? system['palette'] : undefined;
  if (!isPalette(palette)) {
    throw new Error(`The theme has no ${scheme} palette`);
  }
  return palette;
}
