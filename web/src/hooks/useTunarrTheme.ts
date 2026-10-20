import type { Palette, Theme as MuiTheme } from '@mui/material';
import { useColorScheme, useTheme } from '@mui/material';
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPalette = (value: unknown): value is Palette =>
  isRecord(value) &&
  isRecord(value['text']) &&
  isRecord(value['background']) &&
  isRecord(value['primary']);

/**
 * A colour scheme's finished palette, as createTheme keeps it on the theme.
 * MUI only types `colorSchemes` when CSS variables are on, so it is narrowed
 * here.
 */
export function schemePaletteOf(
  theme: MuiTheme,
  scheme: ColorMode,
): Palette | undefined {
  const schemes = 'colorSchemes' in theme ? theme.colorSchemes : undefined;
  const system = isRecord(schemes) ? schemes[scheme] : undefined;
  const palette = isRecord(system) ? system['palette'] : undefined;
  return isPalette(palette) ? palette : undefined;
}

/**
 * The palette of the colour scheme on screen. With CSS variables on,
 * `theme.palette` stays on the default (light) scheme, so code that computes
 * colours from palette values reads them here.
 */
export const useActivePalette = (): Palette => {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  return (
    schemePaletteOf(theme, colorScheme ?? theme.palette.mode) ?? theme.palette
  );
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
