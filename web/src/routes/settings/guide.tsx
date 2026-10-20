import XmlTvSettingsPage from '@/pages/settings/XmlTvSettingsPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/guide')({
  component: XmlTvSettingsPage,
});
