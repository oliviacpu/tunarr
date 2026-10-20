import type { Theme as MuiTheme } from '@mui/material';
import { createTheme } from '@mui/material';
import { esES } from '@mui/material/locale';
import { FormHelperText, Paper } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { StyledMenu } from './components/base/StyledMenu.tsx';
import { contrastRatio, type Scheme, schemePalette } from './test/contrast.ts';
import { Theme } from './theme.ts';

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
  // Labels on filled secondary chips and buttons.
  pairings.push({
    scheme,
    foreground: 'secondary.contrastText',
    background: 'secondary.main',
    foregroundColor: palette.secondary.contrastText,
    backgroundColor: palette.secondary.main,
  });
  return pairings;
}

// Colours that are not text but must stand out from the surface (WCAG 1.4.11,
// 3:1): the secondary spinner on the guide, and secondary outlines and icons.
function nonTextPairings(scheme: Scheme): Pairing[] {
  const palette = schemePalette(scheme);
  return [
    {
      scheme,
      foreground: 'secondary.main',
      background: 'background.paper',
      foregroundColor: palette.secondary.main,
      backgroundColor: palette.background.paper,
    },
  ];
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

  it.each(
    [...nonTextPairings('light'), ...nonTextPairings('dark')].map(
      (pairing) =>
        [
          `${pairing.scheme}: ${pairing.foreground} on ${pairing.background}`,
          pairing,
        ] as const,
    ),
  )(
    '%s passes the non-text minimum (3:1)',
    (_, { foregroundColor, backgroundColor }) => {
      const ratio = contrastRatio(foregroundColor, backgroundColor);
      expect(
        ratio,
        `${foregroundColor} on ${backgroundColor} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    },
  );

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

  it('keeps the flat-Paper border off styled menus', () => {
    const anchorEl = document.createElement('div');
    document.body.appendChild(anchorEl);
    render(
      createElement(
        ThemeProvider,
        { theme: Theme },
        createElement(StyledMenu, { open: true, anchorEl }, 'menu content'),
      ),
    );
    const paper = document.querySelector('.MuiMenu-paper');
    if (paper === null) {
      throw new Error('The menu paper did not render');
    }
    expect(getComputedStyle(paper).borderStyle).toBe('none');
  });
});
