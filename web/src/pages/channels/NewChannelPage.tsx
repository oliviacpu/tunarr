import { PageHeader } from '@/components/base/PageHeader';
import Breadcrumbs from '@/components/Breadcrumbs';
import { EditChannelForm } from '@/components/channel_config/EditChannelForm';
import { Route } from '@/routes/channels_/new';
import { Trans } from '@lingui/react/macro';

export function NewChannelPage() {
  // The route code creates the "working channel"
  const workingChannel = Route.useLoaderData();

  return (
    <>
      <Breadcrumbs />
      {workingChannel && (
        <div>
          <PageHeader title={<Trans>New Channel</Trans>} />
          <EditChannelForm channel={workingChannel} isNew={true} />
        </div>
      )}
    </>
  );
}
