import Breadcrumbs from '@/components/Breadcrumbs.tsx';
import { ChannelOptionsButton } from '@/components/channels/ChannelOptionsButton.tsx';
import { useChannelAndProgramming } from '@/hooks/useChannelLineup.ts';
import { Route } from '@/routes/channels_/$channelId/programming/index.tsx';
import { Trans } from '@lingui/react/macro';
import { Alert, Paper } from '@mui/material';
import { useEffect } from 'react';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import { RouterLink } from '../../components/base/RouterLink.tsx';
import { ChannelProgrammingConfig } from '../../components/channel_config/ChannelProgrammingConfig.tsx';
import UnsavedNavigationAlert from '../../components/settings/UnsavedNavigationAlert.tsx';
import { resetLineup } from '../../store/channelEditor/actions.ts';
import { useChannelEditor } from '../../store/selectors.ts';

export default function ChannelProgrammingPage() {
  const { channelId } = Route.useParams();
  const {
    data: { channel },
  } = useChannelAndProgramming(channelId);

  const {
    schedule,
    dirty: { programs: programsDirty },
  } = useChannelEditor();

  // Force this page to load at the top
  // Fixes issue where some browsers maintain previous page scroll position
  // To do: find better solution
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs />}
        title={channel.name}
        actions={
          <ChannelOptionsButton
            channel={channel}
            hideItems={['programming', 'duplicate', 'delete']}
          />
        }
      />
      {schedule && (
        <Alert sx={{ mb: 2 }} severity="info" component={Paper} elevation={1}>
          <Trans>
            This channel is set up to use{' '}
            <RouterLink
              to={
                schedule.type === 'time'
                  ? '/channels/$channelId/programming/time-slot-editor'
                  : '/channels/$channelId/programming/slot-editor'
              }
              params={{ channelId }}
            >
              {schedule.type === 'time' ? 'Time ' : ' '}
              Slots
            </RouterLink>{' '}
            for programming. Any manual changes on this page will likely make
            this channel stop adhering to that schedule.
          </Trans>
        </Alert>
      )}
      <Paper sx={{ p: 2 }}>
        <ChannelProgrammingConfig />
        <UnsavedNavigationAlert
          isDirty={programsDirty}
          exceptTargetPaths={['/channels/$channelId/programming/add']}
          onProceed={() => resetLineup()}
        />
      </Paper>
    </div>
  );
}
