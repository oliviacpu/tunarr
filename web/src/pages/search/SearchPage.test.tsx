import { renderWithProviders, screen } from '@/test/utils';
import { act } from '@testing-library/react';
import type { SearchRequest } from '@tunarr/types/schemas';
import { afterEach, describe, expect, test, vi } from 'vitest';
import useStore from '../../store/index.ts';
import type { Nullable } from '../../types/util.ts';
import { SearchPage } from './SearchPage.tsx';

// The input and the grid query the API; these tests only check which of them
// the page shows.
vi.mock('../../components/search/SearchInput.tsx', () => ({
  SearchInput: () => <div data-testid="search-input" />,
}));

vi.mock('../../components/library/LibraryProgramGrid.tsx', () => ({
  LibraryProgramGrid: () => <div data-testid="search-results" />,
}));

function setRequest(request: Nullable<SearchRequest>) {
  act(() => {
    useStore.setState((s) => {
      s.currentSearchRequest = request;
    });
  });
}

describe('SearchPage', () => {
  afterEach(() => setRequest(null));

  test('has a Search title', () => {
    renderWithProviders(<SearchPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Search',
    );
  });

  test('shows the empty state and keeps the inputs when there is no query', () => {
    setRequest(null);
    renderWithProviders(<SearchPage />);

    expect(
      screen.getByText('Type to search your libraries'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('search-input')).toBeInTheDocument();
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument();
  });

  test('treats a request with no keywords and no filter as no query', () => {
    setRequest({ query: undefined, filter: undefined });
    renderWithProviders(<SearchPage />);

    expect(
      screen.getByText('Type to search your libraries'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument();
  });

  test('shows results once there are keywords', () => {
    setRequest({ query: 'seinfeld' });
    renderWithProviders(<SearchPage />);

    expect(screen.getByTestId('search-results')).toBeInTheDocument();
    expect(
      screen.queryByText('Type to search your libraries'),
    ).not.toBeInTheDocument();
  });

  test('shows results for a structured filter without keywords', () => {
    setRequest({
      query: null,
      filter: {
        type: 'value',
        fieldSpec: {
          key: 'type',
          name: '',
          op: '=',
          type: 'faceted_string',
          value: ['movie'],
        },
      },
    });
    renderWithProviders(<SearchPage />);

    expect(screen.getByTestId('search-results')).toBeInTheDocument();
  });

  test('switches from the empty state to results when a search is submitted', () => {
    setRequest(null);
    renderWithProviders(<SearchPage />);
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument();

    setRequest({ query: 'seinfeld' });

    expect(screen.getByTestId('search-results')).toBeInTheDocument();
    expect(
      screen.queryByText('Type to search your libraries'),
    ).not.toBeInTheDocument();
  });
});
