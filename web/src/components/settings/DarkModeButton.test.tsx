import { renderWithProviders, screen } from '@/test/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import DarkModeButton from './DarkModeButton.tsx';

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

describe('DarkModeButton (top bar toggle)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test('from the system mode on a light OS, the first click turns dark mode on', async () => {
    stubOsScheme('light');
    const { user } = renderWithProviders(<DarkModeButton iconOnly />);

    await user.click(screen.getByRole('button', { name: 'Enable dark Mode' }));

    expect(
      screen.getByRole('button', { name: 'Enable light Mode' }),
    ).toBeInTheDocument();
  });

  test('from the system mode on a dark OS, the first click turns light mode on', async () => {
    stubOsScheme('dark');
    const { user } = renderWithProviders(<DarkModeButton iconOnly />);

    await user.click(screen.getByRole('button', { name: 'Enable light Mode' }));

    expect(
      screen.getByRole('button', { name: 'Enable dark Mode' }),
    ).toBeInTheDocument();
  });

  test('each later click flips the mode again', async () => {
    stubOsScheme('light');
    const { user } = renderWithProviders(<DarkModeButton iconOnly />);

    await user.click(screen.getByRole('button', { name: 'Enable dark Mode' }));
    await user.click(screen.getByRole('button', { name: 'Enable light Mode' }));

    expect(
      screen.getByRole('button', { name: 'Enable dark Mode' }),
    ).toBeInTheDocument();
  });
});
