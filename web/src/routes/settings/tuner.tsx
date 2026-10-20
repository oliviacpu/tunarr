import HdhrSettingsPage from '@/pages/settings/HdhrSettingsPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/tuner')({
  component: HdhrSettingsPage,
});
