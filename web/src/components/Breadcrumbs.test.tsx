import { renderWithProviders, screen } from '@/test/utils';
import { describe, expect, test, vi } from 'vitest';
import Breadcrumbs from './Breadcrumbs.tsx';

// The router link needs a router; a plain anchor is enough here.
vi.mock('./base/RouterLink.tsx', () => ({
  RouterLink: ({ children }: { children: string }) => (
    <a href="#">{children}</a>
  ),
}));

describe('Breadcrumbs trail', () => {
  test('settings page: linked parent, plain current page', () => {
    renderWithProviders(
      <Breadcrumbs
        trail={[{ label: 'Settings', to: '/settings' }, { label: 'XMLTV' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('XMLTV')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'XMLTV' })).toBeNull();
  });

  test('system page', () => {
    renderWithProviders(
      <Breadcrumbs
        trail={[{ label: 'System', to: '/system' }, { label: 'Tasks' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });
});
