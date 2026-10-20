import { useLingui } from '@lingui/react/macro';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import IconButton from '@mui/material/IconButton';
import type { ReactNode } from 'react';
import { ElevatedTooltip } from './ElevatedTooltip.tsx';

type Props = {
  /** The field or setting the explanation is about, for screen readers. */
  about: string;
  /** The longer explanation, shown on hover, focus or tap. */
  children: ReactNode;
};

/**
 * An info icon that shows a longer explanation of a setting, for help that
 * would run past two lines under the field. It goes at the end of the field's
 * one-line help, or beside a switch's label (outside the label element, so
 * clicking it doesn't toggle the switch).
 */
export function HelpTooltip({ about, children }: Props) {
  const { t } = useLingui();
  return (
    <ElevatedTooltip
      elevation={4}
      title={children}
      describeChild
      enterTouchDelay={0}
      leaveTouchDelay={10_000}
    >
      <IconButton
        size="small"
        aria-label={t`More about ${about}`}
        sx={{
          p: 0.25,
          ml: 0.25,
          verticalAlign: 'middle',
          color: 'text.secondary',
        }}
      >
        <InfoOutlined sx={{ fontSize: '1rem' }} />
      </IconButton>
    </ElevatedTooltip>
  );
}
