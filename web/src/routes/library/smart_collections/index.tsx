import { PageHeader } from '@/components/base/PageHeader.tsx';
import { TableSkeleton } from '@/components/base/TableSkeleton.tsx';
import Breadcrumbs from '@/components/Breadcrumbs.tsx';
import { Trans } from '@lingui/react/macro';
import { Box } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { SmartCollectionsTable } from '../../../components/smart_collections/SmartCollectionsTable.tsx';
import { getApiSmartCollectionsOptions } from '../../../generated/@tanstack/react-query.gen.ts';

export const Route = createFileRoute('/library/smart_collections/')({
  loader({ context: { queryClient } }) {
    return queryClient.ensureQueryData(getApiSmartCollectionsOptions());
  },
  component: RouteComponent,
  pendingComponent: () => <TableSkeleton columns={2} />,
});

function RouteComponent() {
  return (
    <Box>
      <PageHeader
        breadcrumbs={<Breadcrumbs />}
        title={<Trans>Smart Collections</Trans>}
        description={
          <Trans>
            Smart Collections are self-updating content lists. You set the query
            and the collection automatically adds any new content from your
            library that fits those rules. Any newly added content matching
            query will not modify existing channel programming at this time.
          </Trans>
        }
      />
      <SmartCollectionsTable />
    </Box>
  );
}
