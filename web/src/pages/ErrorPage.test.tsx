import { renderWithProviders, screen } from '@/test/utils';
import { describe, expect, test, vi } from 'vitest';
import { ErrorPage } from './ErrorPage.tsx';

vi.mock('../hooks/useVersion.tsx', () => ({
  useVersion: () => ({
    data: { tunarr: '2026.10.2-fork-test' },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useBrowserInfo', () => ({
  useBrowserInfo: () => ({
    getBrowserName: () => 'Test browser',
    getBrowserVersion: () => '42',
    getOSName: () => 'Test OS',
    getOSVersion: () => '7',
  }),
}));

describe('ErrorPage', () => {
  test('prepares a fork bug report with the error and environment fields', () => {
    const error = new Error('The server did not answer');
    renderWithProviders(<ErrorPage error={error} resetRoute={vi.fn()} />);

    const link = screen.getByRole('link', { name: 'File a Bug Report' });
    const href = link.getAttribute('href');
    if (href === null) {
      throw new Error('Bug report link has no destination');
    }
    const url = new URL(href);
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/oliviacpu/tunarr/issues/new');
    expect(url.searchParams.get('template')).toBe('bug_report.yaml');
    expect(url.searchParams.get('browser')).toBe('Test browser (42)');
    expect(url.searchParams.get('os')).toBe('Test OS (7)');
    expect(url.searchParams.get('version')).toBe('2026.10.2-fork-test');
    expect(url.searchParams.get('logs')).toBe(error.stack);
  });
});
