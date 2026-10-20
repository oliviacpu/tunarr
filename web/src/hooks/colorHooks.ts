import { common } from '@mui/material/colors';
import type { ChannelProgram } from '@tunarr/types';
import type Color from 'colorjs.io';
import { useCallback } from 'react';
import {
  pickRandomColor,
  RandomPastels,
  RandomPastelsDarkMode,
} from '../helpers/colors.ts';
import { getProgramGroupingKey } from '../helpers/programUtil.ts';
import { useIsDarkMode } from './useTunarrTheme.ts';

// The scheme on screen, not the stored mode: under 'system' on a dark OS the
// mode is 'system' but the scheme is dark.
const useRandomColorPalette = () => {
  return useIsDarkMode() ? RandomPastelsDarkMode : RandomPastels;
};

export const useRandomProgramBackgroundColor = () => {
  const palette = useRandomColorPalette();
  return useCallback(
    (program: ChannelProgram, paletteOverride?: Color[]) => {
      return pickRandomColor(
        getProgramGroupingKey(program),
        paletteOverride ?? palette,
      );
    },
    [palette],
  );
};

export const useGetContrastText = () => {
  return useCallback((color: Color) => {
    return color.contrastWCAG21(common.white) > 3
      ? common.white
      : 'rgba(0, 0, 0, 0.87)';
  }, []);
};
