import { ListItem, styled } from '@mui/material';
import Color from 'colorjs.io';
import type React from 'react';
import type { UIChannelProgram } from '../../types/index.ts';
import type { GuideCellStyle } from '../guide/guideColors.ts';

type Props = {
  enableDrag?: boolean;
  isDragging: boolean;
  program: UIChannelProgram;
  cellStyle: GuideCellStyle;
  dividerColor: string;
  relativeDuration?: number;
  style?: React.CSSProperties;
  indented?: boolean;
  enableDelete?: boolean;
};

export const ChannelLineupListItem = styled(ListItem, {
  shouldForwardProp: (prop) =>
    prop !== 'enableDrag' &&
    prop !== 'isDragging' &&
    prop !== 'program' &&
    prop !== 'cellStyle' &&
    prop !== 'dividerColor' &&
    prop !== 'relativeDuration' &&
    prop !== 'indented' &&
    prop !== 'enableDelete',
})<Props>(({
  style,
  cellStyle,
  dividerColor,
  relativeDuration,
  program,
  enableDrag,
  isDragging,
  indented,
  enableDelete,
}) => {
  const relativePct = relativeDuration ? relativeDuration * 100.0 : null;
  const bgHex = cellStyle.background;
  const progressColor = cellStyle.hoverBackground;

  let bg: string;
  if (program.type === 'flex') {
    const contrastColor = new Color(new Color(bgHex).darken(0.05)).toString({
      format: 'hex',
    });
    bg = `repeating-linear-gradient(-45deg,
              ${bgHex},
              ${bgHex} 10px,
              ${contrastColor} 10px,
              ${contrastColor} 20px)`;
  } else if (relativePct) {
    bg = `linear-gradient(to right, ${progressColor} 0%, ${progressColor} ${relativePct}%, ${bgHex} ${relativePct}%, ${bgHex} 100%)`;
  } else {
    bg = bgHex;
  }

  return {
    ...(style ?? {}),
    border: enableDrag
      ? isDragging
        ? '1px dashed gray'
        : undefined
      : undefined,
    cursor: enableDrag ? (isDragging ? 'grabbing' : 'grab') : 'default',
    borderBottom: 'thin solid',
    // [theme.breakpoints.up('sm')]: {
    //   marginLeft: theme.spacing(1),
    //   width: 'auto',
    // },
    color: cellStyle.color,
    fontVariantNumeric: 'tabular-nums',
    outline: cellStyle.outline,
    outlineOffset: cellStyle.outline !== undefined ? '-2px' : undefined,
    background: bg,
    '&:hover': {
      background: isDragging ? 'transparent' : cellStyle.hoverBackground,
    },
    borderBottomColor: dividerColor,
    paddingRight: enableDelete ? '96px' : undefined,
    ...(indented && {
      paddingLeft: '5em',
      borderLeft: `3px solid ${dividerColor}`,
    }),
  };
});
