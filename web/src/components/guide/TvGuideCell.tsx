import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { ProgramTypeIcon } from '../base/ProgramTypeIcon.tsx';
import type { GuideCellStyle, GuideGlyph } from './guideColors.ts';
import { TvGuideItem } from './TvGuideItem.tsx';

// Below CompactBlockPx a cell drops its text, because it would only show as a
// clipped fragment. The type glyph needs more room, so narrow cells keep
// their letters for the title.
export const CompactBlockPx = 24;
export const GlyphBlockPx = 64;

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
  // The cell's width on screen, or undefined before the grid is measured.
  pixelWidth: number | undefined;
  nowPlaying?: boolean;
  paused?: boolean;
  clickable?: boolean;
  onClick?: () => void;
  // Further lines under the subtitle (times, time left).
  children?: ReactNode;
};

/**
 * One program, flex gap or redirect on the guide: the type glyph and title,
 * the subtitle, and any further lines. A sliver shows its title only as a
 * tooltip, and a narrow cell shows text without the glyph.
 */
export function TvGuideCell({
  cellStyle,
  title,
  subtitle,
  pixelWidth,
  children,
  ...item
}: Props) {
  const compact = pixelWidth !== undefined && pixelWidth < CompactBlockPx;
  const glyph =
    pixelWidth !== undefined && pixelWidth >= GlyphBlockPx
      ? cellStyle.glyph
      : undefined;
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
            {glyph !== undefined ? <CellGlyph glyph={glyph} /> : null}
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
