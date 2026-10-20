import { styled } from '@mui/material';
import { TvGuideGridChild } from './TvGuideGridChild.tsx';
import type { GuideCellStyle } from './guideColors.ts';

const ItemOnlyProps = new Set<PropertyKey>([
  'cellStyle',
  'left',
  'compact',
  'ringColor',
  'paused',
  'clickable',
]);

export const TvGuideItem = styled(TvGuideGridChild, {
  shouldForwardProp: (prop) => !ItemOnlyProps.has(prop),
})<{
  cellStyle: GuideCellStyle;

  // Percentages of the guide window
  left: number;
  width: number;

  // Too narrow for text. Drops the gap and padding so neighboring slivers
  // stay visible instead of collapsing into their borders.
  compact?: boolean;

  // The program on air now gets a ring in the guide's one accent (primary).
  ringColor?: string;

  // A paused program (on-demand channel) is striped with its own colour.
  paused?: boolean;

  clickable?: boolean;
}>(({ left, width, cellStyle, compact, ringColor, paused, clickable }) => {
  const stripes = (base: string, stripe: string) =>
    `repeating-linear-gradient(-45deg,
      ${base},
      ${base} 10px,
      ${stripe} 10px,
      ${stripe} 20px)`;

  const background = paused
    ? stripes(cellStyle.background, cellStyle.hoverBackground)
    : cellStyle.background;
  const hoverBackground = paused
    ? stripes(cellStyle.hoverBackground, cellStyle.background)
    : cellStyle.hoverBackground;

  const ringWidth = compact ? 1 : 2;
  const boxShadow =
    ringColor !== undefined
      ? `inset 0 0 0 ${ringWidth}px ${ringColor}`
      : compact
        ? 'inset -1px 0 0 rgba(0, 0, 0, 0.3)'
        : undefined;

  return {
    display: 'flex',
    alignItems: 'flex-start',
    background,
    color: cellStyle.color,

    // Blocks are placed by time. The transparent border draws the gap between
    // neighbors without taking width from the layout.
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: `${left}%`,
    width: `${width}%`,
    boxSizing: 'border-box',
    minWidth: 0,
    backgroundClip: 'padding-box',
    borderStyle: 'solid',
    borderWidth: compact ? '2px 0' : '2px',
    borderColor: 'transparent',
    borderRadius: compact ? 0 : '5px',
    // The dashed outline of a flex gap sits just inside the fill, so the gap
    // between neighbours stays clear.
    outline: cellStyle.outline,
    outlineOffset: cellStyle.outline !== undefined ? '-3px' : undefined,
    padding: compact ? 0 : '1px 4px',
    boxShadow,
    transition: 'left 0.5s ease-in, width 0.5s ease-in',
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    cursor: clickable ? 'pointer' : 'default',
    '&:hover': {
      background: hoverBackground,
    },
  };
});
