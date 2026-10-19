import { describe, expect, test } from 'vitest';
import { nextColorMode } from './useTunarrTheme.ts';

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
