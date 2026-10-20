import type { Palette, Theme as MuiTheme } from '@mui/material';
import { createTheme } from '@mui/material';
import { esES } from '@mui/material/locale';
import { decomposeColor, hslToRgb } from '@mui/material/styles';
import { FormHelperText, Paper } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Theme } from './theme.ts';

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

function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  const fg = composite(parseColor(foreground), bg);
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

type Scheme = 'light' | 'dark';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPalette = (value: unknown): value is Palette =>
  isRecord(value) &&
  isRecord(value['text']) &&
  isRecord(value['background']) &&
  isRecord(value['primary']);

// createTheme keeps each scheme's finished palette on the theme. MUI only
// types `colorSchemes` when CSS variables are on, so narrow it here.
function schemePalette(scheme: Scheme, theme: MuiTheme = Theme): Palette {
  const schemes = 'colorSchemes' in theme ? theme.colorSchemes : undefined;
  const system = isRecord(schemes) ? schemes[scheme] : undefined;
  const palette = isRecord(system) ? system['palette'] : undefined;
  if (!isPalette(palette)) {
    throw new Error(`The theme has no ${scheme} palette`);
  }
  return palette;
}

type Pairing = {
  scheme: Scheme;
  foreground: string;
  background: string;
  foregroundColor: string;
  backgroundColor: string;
};

function textPairings(scheme: Scheme): Pairing[] {
  const palette = schemePalette(scheme);
  const surfaces: Record<string, string> = {
    'background.default': palette.background.default,
    'background.paper': palette.background.paper,
  };
  // Colours used as text: body text, links, outlined and text button labels,
  // and coloured status text.
  const texts: Record<string, string> = {
    'text.primary': palette.text.primary,
    'text.secondary': palette.text.secondary,
    'primary.main': palette.primary.main,
    'error.main': palette.error.main,
    'warning.main': palette.warning.main,
    'success.main': palette.success.main,
    'info.main': palette.info.main,
  };
  const pairings: Pairing[] = [];
  for (const [foreground, foregroundColor] of Object.entries(texts)) {
    for (const [background, backgroundColor] of Object.entries(surfaces)) {
      pairings.push({
        scheme,
        foreground,
        background,
        foregroundColor,
        backgroundColor,
      });
    }
  }
  // Contained button labels.
  pairings.push({
    scheme,
    foreground: 'primary.contrastText',
    background: 'primary.main',
    foregroundColor: palette.primary.contrastText,
    backgroundColor: palette.primary.main,
  });
  return pairings;
}

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // The usual "just fails AA" grey.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#ffffff', '#777777')).toBeCloseTo(4.48, 2);
  });

  it('blends a translucent foreground over the background', () => {
    expect(contrastRatio('rgba(0, 0, 0, 0.5)', '#ffffff')).toBeCloseTo(
      contrastRatio('rgb(127.5, 127.5, 127.5)', '#ffffff'),
      5,
    );
  });
});

describe('Theme', () => {
  it.each<Scheme>(['light', 'dark'])('has a %s palette', (scheme) => {
    expect(schemePalette(scheme).mode).toBe(scheme);
  });

  it.each(
    [...textPairings('light'), ...textPairings('dark')].map(
      (pairing) =>
        [
          `${pairing.scheme}: ${pairing.foreground} on ${pairing.background}`,
          pairing,
        ] as const,
    ),
  )('%s passes WCAG AA (4.5:1)', (_, { foregroundColor, backgroundColor }) => {
    const ratio = contrastRatio(foregroundColor, backgroundColor);
    expect(
      ratio,
      `${foregroundColor} on ${backgroundColor} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('sets IBM Plex Sans as the UI font', () => {
    expect(Theme.typography.fontFamily).toMatch(/^'IBM Plex Sans/);
  });

  it('makes outlined the default button variant', () => {
    expect(Theme.components?.MuiButton?.defaultProps?.variant).toBe('outlined');
  });

  it('survives a locale layered on top, as Tunarr.tsx does', () => {
    const localized = createTheme(Theme, esES);

    expect(localized.typography.fontFamily).toBe(Theme.typography.fontFamily);
    expect(localized.components?.MuiButton?.defaultProps?.variant).toBe(
      'outlined',
    );
    for (const scheme of ['light', 'dark'] as const) {
      expect(schemePalette(scheme, localized).background).toEqual(
        schemePalette(scheme).background,
      );
      expect(schemePalette(scheme, localized).primary.main).toBe(
        schemePalette(scheme).primary.main,
      );
    }
  });

  describe('colour scheme overrides in dark mode', () => {
    const renderDark = (theme: MuiTheme) =>
      render(
        createElement(
          ThemeProvider,
          { theme, defaultMode: 'dark' },
          createElement(FormHelperText, null, 'helper text'),
          createElement(Paper, { elevation: 0 }, 'flat paper'),
        ),
      );

    it('does not render helper text as translucent black', () => {
      renderDark(Theme);
      const { color } = getComputedStyle(screen.getByText('helper text'));
      expect(color).not.toMatch(/^rgba\(0,\s*0,\s*0,/);
    });

    it('draws the flat Paper border with the dark divider', () => {
      renderDark(Theme);
      const paper = screen.getByText('flat paper');
      expect(getComputedStyle(paper).borderTopColor).toBe(
        'rgba(255, 255, 255, 0.12)',
      );
    });

    // With CSS variables the theme's own palette stays on the default (light)
    // scheme, so only (theme.vars || theme) follows the active scheme. jsdom
    // does not resolve var(), so assert the light literal is not baked in.
    it('does not bake the light palette in when CSS variables are on', () => {
      const light = schemePalette('light');
      renderDark(
        createTheme({
          cssVariables: true,
          colorSchemes: {
            light: { palette: light },
            dark: { palette: schemePalette('dark') },
          },
          components: Theme.components,
        }),
      );
      const helper = getComputedStyle(screen.getByText('helper text'));
      const paper = getComputedStyle(screen.getByText('flat paper'));
      expect(helper.color).not.toBe(light.text.secondary);
      expect(paper.borderTopColor).not.toBe(light.divider);
    });
  });
});
