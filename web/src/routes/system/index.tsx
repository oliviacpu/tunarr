import { createFileRoute } from '@tanstack/react-router';
import {
  getApiSystemMigrationStateOptions,
  getApiSettingsSystemOptions,
} from '../../generated/@tanstack/react-query.gen.ts';
import { StatusPage } from '../../pages/system/StatusPage.tsx';

export const Route = createFileRoute('/system/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      ...getApiSettingsSystemOptions(),
    });

    await context.queryClient.ensureQueryData({
      ...getApiSystemMigrationStateOptions(),
    });
  },
  component: StatusPage,
});
