import { renderWithProviders, screen } from '@/test/utils';
import { Button } from '@mui/material';
import { describe, expect, test } from 'vitest';
import { PageHeader } from './PageHeader.tsx';

describe('PageHeader', () => {
  test('renders the title as the h1', () => {
    renderWithProviders(<PageHeader title="Channels" />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Channels');
    expect(heading.tagName).toBe('H1');
    expect(heading).toHaveClass('MuiTypography-h1');
  });

  test('accepts a node as the title', () => {
    renderWithProviders(
      <PageHeader title={<span data-testid="title-node">Guide</span>} />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toContainElement(
      screen.getByTestId('title-node'),
    );
  });

  test('renders description, actions and breadcrumbs when given', () => {
    renderWithProviders(
      <PageHeader
        title="Filler Lists"
        description="Videos that play during flex time."
        actions={<Button>New</Button>}
        breadcrumbs={<nav aria-label="crumbs">Library › Fillers</nav>}
      />,
    );

    const description = screen.getByText('Videos that play during flex time.');
    expect(description).toHaveClass('MuiTypography-body2');
    expect(description).toHaveStyle({ maxWidth: '72ch' });
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();

    // Breadcrumbs sit above the title.
    const crumbs = screen.getByRole('navigation', { name: 'crumbs' });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(
      crumbs.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('renders only the title when nothing else is given', () => {
    const { container } = renderWithProviders(<PageHeader title="Trash" />);

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(container.querySelector('.MuiTypography-body2')).toBeNull();
    expect(container).toHaveTextContent(/^Trash$/);
  });

  test('treats null description and actions as absent', () => {
    const { container } = renderWithProviders(
      <PageHeader title="Search" description={null} actions={null} />,
    );

    expect(container.querySelector('.MuiTypography-body2')).toBeNull();
    // Header wrapper > title row > title column only.
    const titleRow = screen.getByRole('heading', { level: 1 }).parentElement
      ?.parentElement;
    expect(titleRow?.children).toHaveLength(1);
  });

  test('leaves theme.spacing(2) below itself', () => {
    const { container } = renderWithProviders(<PageHeader title="System" />);

    expect(container.firstElementChild).toHaveStyle({ marginBottom: '16px' });
  });
  test('uses a section heading below a layout that already owns the h1', () => {
    renderWithProviders(
      <>
        <h1>Settings</h1>
        <PageHeader title="New transcode config" headingLevel="h2" />
      </>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 2, name: 'New transcode config' }),
    ).toBeInTheDocument();
  });
});
