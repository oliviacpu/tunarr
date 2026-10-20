import { ThemeProvider } from '@mui/material';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RandomPastels, RandomPastelsDarkMode } from '../helpers/colors.ts';
import {
  makeContentProgram,
  makeEpisode,
  makeShowGrouping,
} from '../test/programFixtures.ts';
import { Theme } from '../theme.ts';
import { useRandomProgramBackgroundColor } from './colorHooks.ts';

// jsdom has no matchMedia. MUI reads the OS scheme from this query while the
// mode is 'system', which it is until the user picks one.
function stubOsScheme(scheme: 'light' | 'dark') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: scheme === 'dark' && query === '(prefers-color-scheme: dark)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider theme={Theme}>{children}</ThemeProvider>
);

const program = makeContentProgram(
  makeEpisode({ show: makeShowGrouping('show-1') }),
  1000,
);

describe('useRandomProgramBackgroundColor', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test('under the system mode on a dark OS, picks from the dark palette', () => {
    stubOsScheme('dark');
    const { result } = renderHook(() => useRandomProgramBackgroundColor(), {
      wrapper,
    });

    const color = result.current(program);

    expect(RandomPastelsDarkMode).toContain(color);
    expect(RandomPastels).not.toContain(color);
  });

  test('under the system mode on a light OS, picks from the light palette', () => {
    stubOsScheme('light');
    const { result } = renderHook(() => useRandomProgramBackgroundColor(), {
      wrapper,
    });

    const color = result.current(program);

    expect(RandomPastels).toContain(color);
    expect(RandomPastelsDarkMode).not.toContain(color);
  });
});
