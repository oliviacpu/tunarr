import { SettingsLayout } from '@/pages/settings/SettingsLayout';
import { createFileRoute, useChildMatches } from '@tanstack/react-router';
import { head } from 'lodash-es';

export const Route = createFileRoute('/settings')({
  component: Wrapper,
});

function Wrapper() {
  const firstChild = useChildMatches();
  return (
    <SettingsLayout
      currentTab={
        '/' +
        head(firstChild)
          ?.fullPath.replace(/^\/settings/, '')
          .split('/')[1]
      }
    />
  );
}
