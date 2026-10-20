import { createTheme, ThemeProvider } from '@mui/material';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { schemePalette } from '../test/contrast.ts';
import { Theme } from '../theme.ts';
import { nextColorMode, useActivePalette } from './useTunarrTheme.ts';

describe('nextColorMode', () => {
  test('a chosen light mode goes dark', () => {
    expect(nextColorMode('light', 'light')).toBe('dark');
  });

  test('a chosen dark mode goes light', () => {
    expect(nextColorMode('dark', 'dark')).toBe('light');
  });

  test('the system mode on a light OS goes dark', () => {
    expect(nextColorMode('system', 'light')).toBe('dark');
  });

  test('the system mode on a dark OS goes light', () => {
    expect(nextColorMode('system', 'dark')).toBe('light');
  });

  test('before the mode is known, the scheme on screen flips', () => {
    expect(nextColorMode(undefined, 'dark')).toBe('light');
    expect(nextColorMode(undefined, 'light')).toBe('dark');
    // The default scheme is light, so dark is the visible change.
    expect(nextColorMode(undefined, undefined)).toBe('dark');
  });
});

describe('useActivePalette', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // With CSS variables on, theme.palette stays on the default (light) scheme
  // whatever is on screen.
  const cssVariablesTheme = createTheme({
    cssVariables: true,
    colorSchemes: {
      light: { palette: schemePalette('light') },
      dark: { palette: schemePalette('dark') },
    },
    components: Theme.components,
  });

  const renderUnder = (defaultMode: 'light' | 'dark') =>
    renderHook(() => useActivePalette(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(
          ThemeProvider,
          { theme: cssVariablesTheme, defaultMode },
          children,
        ),
    });

  test('the CSS-variables theme keeps its own palette light', () => {
    expect(cssVariablesTheme.palette.mode).toBe('light');
  });

  test('returns the dark palette in dark mode', () => {
    const { result } = renderUnder('dark');
    expect(result.current.mode).toBe('dark');
    expect(result.current.background.paper).toBe(
      schemePalette('dark').background.paper,
    );
  });

  test('returns the light palette in light mode', () => {
    const { result } = renderUnder('light');
    expect(result.current.mode).toBe('light');
    expect(result.current.background.paper).toBe(
      schemePalette('light').background.paper,
    );
  });

  test('follows the scheme without CSS variables too', () => {
    const { result } = renderHook(() => useActivePalette(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(
          ThemeProvider,
          { theme: Theme, defaultMode: 'dark' },
          children,
        ),
    });
    expect(result.current.background.paper).toBe(
      schemePalette('dark').background.paper,
    );
  });
});
