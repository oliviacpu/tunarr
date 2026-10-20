import { useLingui } from '@lingui/react/macro';
import { Chip, Tooltip } from '@mui/material';
import { useState } from 'react';
import type {
  SettingsApplicationKey,
  SettingsApplicationWhen,
} from '@tunarr/types';
import { SettingsApplicationTiming } from '@tunarr/types';

export function AppliesWhen({ setting }: { setting: SettingsApplicationKey }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const timing = SettingsApplicationTiming[setting];
  const labels: Record<SettingsApplicationWhen, string> = {
    live: t`Live`,
    'next-session': t`Next session`,
    'next-program': t`Next program`,
    restart: t`Restart required`,
  };
  return (
    <Tooltip
      title={timing.description}
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
        aria-label={`${timing.title}: ${labels[timing.when]}`}
        tabIndex={0}
        data-settings-timing={setting}
        sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
      />
    </Tooltip>
  );
}
