import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { ProgramTypeIcon } from '../base/ProgramTypeIcon.tsx';
import type { GuideCellStyle, GuideGlyph } from './guideColors.ts';
import { TvGuideItem } from './TvGuideItem.tsx';

function CellGlyph({ glyph }: { glyph: GuideGlyph }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        flexShrink: 0,
        '& .MuiSvgIcon-root': { fontSize: '14px' },
      }}
    >
      {glyph === 'redirect' ? (
        <ArrowForwardIcon />
      ) : (
        <ProgramTypeIcon programType={glyph} />
      )}
    </Box>
  );
}

type Props = {
  // Percentages of the guide window
  left: number;
  width: number;
  cellStyle: GuideCellStyle;
  title: string;
  subtitle: string;
  // Too narrow for text: the cell drops its text and glyph and shows the
  // title as a tooltip.
  compact: boolean;
  nowPlaying?: boolean;
  paused?: boolean;
  clickable?: boolean;
  onClick?: () => void;
  // Further lines under the subtitle (times, time left).
  children?: ReactNode;
};

/**
 * One program, flex gap or redirect on the guide: the type glyph and title,
 * the subtitle, and any further lines, unless the cell is a sliver.
 */
export function TvGuideCell({
  cellStyle,
  title,
  subtitle,
  compact,
  children,
  ...item
}: Props) {
  return (
    <TvGuideItem
      {...item}
      cellStyle={cellStyle}
      compact={compact}
      title={compact ? title : undefined}
    >
      {compact ? null : (
        <>
          <Box
            sx={{
              fontSize: '14px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              minWidth: 0,
            }}
          >
            {cellStyle.glyph !== undefined ? (
              <CellGlyph glyph={cellStyle.glyph} />
            ) : null}
            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {title}
            </Box>
          </Box>
          <Box sx={{ fontSize: '13px', fontStyle: 'italic' }}>{subtitle}</Box>
          {children}
        </>
      )}
    </TvGuideItem>
  );
}
