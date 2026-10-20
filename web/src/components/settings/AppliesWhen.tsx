import { useLingui } from '@lingui/react/macro';
import { Chip, Tooltip } from '@mui/material';
import { useState } from 'react';
import type {
  SettingsApplicationKey,
  SettingsApplicationWhen,
} from '@tunarr/types';
import { SettingsApplicationTiming } from '@tunarr/types';
import { SettingsApplicationMessages } from './settingsApplicationMessages.ts';

export function AppliesWhen({ setting }: { setting: SettingsApplicationKey }) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const timing = SettingsApplicationTiming[setting];
  const messages = SettingsApplicationMessages[setting];
  const title = i18n._(messages.title);
  const description = i18n._(messages.description);
  const labels: Record<SettingsApplicationWhen, string> = {
    live: t`Live`,
    'next-session': t`Next session`,
    'next-program': t`Next program`,
    restart: t`Restart required`,
  };
  return (
    <Tooltip
      title={description}
      describeChild
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      enterTouchDelay={0}
    >
      <Chip
        component="span"
        clickable
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        size="small"
        variant="outlined"
        label={labels[timing.when]}
        aria-label={`${title}: ${labels[timing.when]}`}
        tabIndex={0}
        data-settings-timing={setting}
        sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
      />
    </Tooltip>
  );
}
