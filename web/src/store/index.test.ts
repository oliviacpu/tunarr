import { get } from 'lodash-es';
import { afterEach, describe, expect, test, vi } from 'vitest';
import useStore from './index.ts';

const StorageKey = 'tunarr';

function storedTheme(): unknown {
  const raw = localStorage.getItem(StorageKey);
  if (raw === null) {
    throw new Error('the store wrote nothing to localStorage');
  }
  const parsed: unknown = JSON.parse(raw);
  return get(parsed, ['state', 'theme']);
}

describe('persisted store hydration', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // Older builds stored theme.themePreference, and on load added it to themes
  // stored before it existed (from darkMode). Nothing reads it any more.
  test.each([
    {
      name: 'a theme with themePreference',
      theme: { darkMode: true, themePreference: 'dark' },
    },
    {
      name: 'a theme from before themePreference',
      theme: { darkMode: true },
    },
  ])('$name hydrates without themePreference', async ({ theme }) => {
    localStorage.setItem(
      StorageKey,
      JSON.stringify({
        state: {
          theme: {
            ...theme,
            showWelcome: false,
            guideDuration: 3_600_000,
            programmingSelectorView: 'list',
          },
        },
        version: 0,
      }),
    );
    const consoleError = vi.spyOn(console, 'error');

    await expect(useStore.persist.rehydrate()).resolves.toBeUndefined();

    const hydrated = useStore.getState().theme;
    expect(hydrated).not.toHaveProperty('themePreference');
    expect(hydrated).toMatchObject({
      showWelcome: false,
      guideDuration: 3_600_000,
      programmingSelectorView: 'list',
    });
    // The state written back after hydrating drops the key too.
    expect(storedTheme()).not.toHaveProperty('themePreference');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
