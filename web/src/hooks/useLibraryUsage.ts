import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  getApiCustomShowsUsedByOptions,
  getApiFillerListsUsedByOptions,
  getApiSmartCollectionsUsedByOptions,
} from '../generated/@tanstack/react-query.gen.ts';

export type LibraryUsageKind =
  | 'fillerLists'
  | 'customShows'
  | 'smartCollections';

export function useLibraryUsage(kind: LibraryUsageKind, enabled = true) {
  const options =
    kind === 'fillerLists'
      ? getApiFillerListsUsedByOptions()
      : kind === 'customShows'
        ? getApiCustomShowsUsedByOptions()
        : getApiSmartCollectionsUsedByOptions();
  const { data, isPending, isFetching, isError } = useQuery({
    ...options,
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  return useMemo(
    () => ({ data, isPending, isFetching, isError }),
    [data, isPending, isFetching, isError],
  );
}
