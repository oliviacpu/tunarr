import { renderWithProviders, screen } from '@/test/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { schemePalette } from '../../test/contrast.ts';
import { ReducedMotionQuery, TvGuideNowMarker } from './TvGuideNowMarker.tsx';

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === ReducedMotionQuery,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// The pill's text box sits inside the positioned wrapper; the line is the
// wrapper's next sibling.
function markerParts() {
  const pillText = screen.getByText('9:41 AM');
  const pill = pillText.parentElement;
  const line = pill?.nextElementSibling;
  if (!pill || !line) {
    throw new Error('The time marker did not render');
  }
  return { pillText, pill, line };
}

describe('TvGuideNowMarker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test('glides to the new time by default', () => {
    stubReducedMotion(false);
    renderWithProviders(<TvGuideNowMarker progress={40} label="9:41 AM" />);

    const { pill, line } = markerParts();
    expect(getComputedStyle(pill).transition).toContain('left 0.5s');
    expect(getComputedStyle(line).transition).toContain('left 0.5s');
    expect(getComputedStyle(pill).left).toBe('40%');
  });

  test('jumps without animating when the user prefers reduced motion', () => {
    stubReducedMotion(true);
    renderWithProviders(<TvGuideNowMarker progress={40} label="9:41 AM" />);

    const { pill, line } = markerParts();
    expect(getComputedStyle(pill).transition).toBe('none');
    expect(getComputedStyle(line).transition).toBe('none');
  });

  test('wears the primary accent', () => {
    stubReducedMotion(false);
    renderWithProviders(<TvGuideNowMarker progress={40} label="9:41 AM" />);

    const { pillText } = markerParts();
    const primary = schemePalette('light').primary.main;
    expect(getComputedStyle(pillText).backgroundColor).toBe(toRgb(primary));
  });
});

function toRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
