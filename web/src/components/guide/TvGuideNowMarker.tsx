import { Box, useMediaQuery } from '@mui/material';
import { useActivePalette } from '../../hooks/useTunarrTheme.ts';

export const ReducedMotionQuery = '(prefers-reduced-motion: reduce)';

type Props = {
  /** Where now falls in the guide window, as a percentage. */
  progress: number;
  /** The current time, as shown in the pill. */
  label: string;
};

/**
 * The current-time marker: a pill with the time over a line down the grid.
 * It carries the guide's one accent (primary). It glides to each new minute,
 * unless the user asks the system for reduced motion.
 */
export function TvGuideNowMarker({ progress, label }: Props) {
  const palette = useActivePalette();
  const reduceMotion = useMediaQuery(ReducedMotionQuery);

  return (
    <>
      {/* Shifting the pill left by its own progress fraction keeps it
          inside the grid at both edges. */}
      <Box
        sx={{
          position: 'absolute',
          left: `${progress}%`,
          transform: `translateX(-${progress}%)`,
          transition: reduceMotion
            ? 'none'
            : 'left 0.5s linear, transform 0.5s linear',
          zIndex: 11,
        }}
      >
        <Box
          sx={{
            position: 'relative',
            background: palette.primary.main,
            color: palette.primary.contrastText,
            minWidth: '50px',
            width: 'max-content',
            px: 1,
            borderRadius: '5px',
            fontSize: '14px',
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'center',
            zIndex: 2,
          }}
        >
          {label}
        </Box>
      </Box>
      <Box
        sx={{
          position: 'absolute',
          left: `${progress}%`,
          transition: reduceMotion ? 'none' : 'left 0.5s linear',
          height: '100%',
          zIndex: 10,
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: '2px',
            background: palette.primary.main,
            height: '100%',
            mt: '-2px',
          }}
        />
      </Box>
    </>
  );
}
