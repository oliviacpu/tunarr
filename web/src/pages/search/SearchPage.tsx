import { Trans } from '@lingui/react/macro';
import { Box, Stack, Typography } from '@mui/material';
import { isNonEmptyString } from '@tunarr/shared/util';
import type { SearchFilter, SearchRequest } from '@tunarr/types/schemas';
import { isNil } from 'lodash-es';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import { LibraryProgramGrid } from '../../components/library/LibraryProgramGrid.tsx';
import { SearchInput } from '../../components/search/SearchInput.tsx';
import useStore from '../../store/index.ts';
import type { Nullable } from '../../types/util.ts';

type Props = {
  initialSearchFilter?: SearchFilter;
};

// A request with neither keywords nor a filter would list the whole library,
// which is the Library page's job, so the search page waits for a query.
function hasQuery(request: Nullable<SearchRequest>) {
  if (request === null) {
    return false;
  }
  return isNonEmptyString(request.query) || !isNil(request.filter);
}

export function SearchPage({ initialSearchFilter }: Props) {
  const searchRequest = useStore((s) => s.currentSearchRequest);

  return (
    <Box>
      <PageHeader title={<Trans>Search</Trans>} />
      <Stack gap={2}>
        <SearchInput initialSearchFilter={initialSearchFilter} showViewToggle />
        {hasQuery(searchRequest) ? (
          <LibraryProgramGrid disableProgramSelection />
        ) : (
          <Typography color="text.secondary">
            <Trans>Type to search your libraries</Trans>
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
