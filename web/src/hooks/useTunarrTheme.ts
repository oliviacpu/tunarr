import { useColorScheme } from '@mui/material';
import { useMemo } from 'react';
import { Theme } from '../theme.ts';

export type ColorMode = 'light' | 'dark';

export const useTunarrTheme = () => {
  return useMemo(() => Theme, []);
};

export const useSetColorScheme = () => {
  return useColorScheme().setColorScheme;
};

export const useIsDarkMode = () => {
  return useColorScheme().colorScheme === 'dark';
};

/**
 * The mode the light/dark toggle switches to. A chosen light or dark mode
 * flips. Under 'system' (or before MUI has read the stored mode) the toggle
 * flips the scheme on screen, so the first click away from the system scheme
 * always changes what the user sees.
 */
export const nextColorMode = (
  mode: ColorMode | 'system' | undefined,
  resolved: ColorMode | undefined,
): ColorMode => {
  if (mode === 'light') {
    return 'dark';
  }
  if (mode === 'dark') {
    return 'light';
  }
  return resolved === 'dark' ? 'light' : 'dark';
};
