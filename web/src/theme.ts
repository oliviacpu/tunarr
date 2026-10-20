import { type PaletteOptions, createTheme } from '@mui/material';

// The direction and every value below come from
// plans/ui-primitives-and-settings-audit-2026-10-19.md (section 2, issue D1).
// theme.test.ts checks every text colour pairing against WCAG AA (4.5:1).

/** IBM Plex Sans is bundled by @fontsource-variable/ibm-plex-sans (main.tsx). */
export const FontFamily =
  "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif";

/** Paper and dialog corners; inputs and buttons use shape.borderRadius. */
export const SurfaceRadius = 10;

// Sizes are in rem against the browser's 16px root, so a larger default font
// size in the browser still scales the whole UI.
const rem = (px: number) => `${px / 16}rem`;

const LightPalette: PaletteOptions = {
  mode: 'light',
  primary: {
    // The old brand teal, #008c93, is 4.06:1 on white and fails AA as text.
    main: '#00757c',
  },
  secondary: {
    main: '#004b79',
  },
  error: {
    main: '#892d22',
  },
  warning: {
    // Darkened from #FF9800 (2.2:1 on white) to pass AA as text.
    main: '#a46100',
  },
  info: {
    // Darkened from #9EA1B3 (2.6:1 on white) to pass AA as text.
    main: '#676e88',
  },
  success: {
    main: '#0A772A',
  },
  background: {
    default: '#f5fafc',
    paper: '#ffffff',
  },
  divider: 'rgba(0, 30, 40, 0.12)',
};

const DarkPalette: PaletteOptions = {
  mode: 'dark',
  primary: {
    main: '#2fb7c0',
  },
  secondary: {
    main: '#004b79',
  },
  error: {
    main: '#e07b6c',
  },
  warning: {
    main: '#f0a330',
  },
  info: {
    main: '#94a6c4',
  },
  success: {
    main: '#4caf7d',
  },
  background: {
    default: '#10191c',
    paper: '#182328',
  },
  divider: 'rgba(255, 255, 255, 0.12)',
};

export const Theme = createTheme({
  colorSchemes: {
    dark: {
      palette: DarkPalette,
    },
    light: {
      palette: LightPalette,
    },
  },
  defaultColorScheme: 'light',
  spacing: 8,
  shape: {
    borderRadius: 6,
  },
  typography: {
    fontFamily: FontFamily,
    h1: {
      fontSize: rem(28),
      fontWeight: 600,
      lineHeight: 1.25,
      letterSpacing: '-0.01em',
    },
    h2: {
      fontSize: rem(22),
      fontWeight: 600,
      lineHeight: 1.3,
      letterSpacing: '-0.005em',
    },
    h3: {
      fontSize: rem(18),
      fontWeight: 600,
      lineHeight: 1.35,
      letterSpacing: 0,
    },
    h4: {
      fontSize: rem(16),
      fontWeight: 600,
      lineHeight: 1.4,
      letterSpacing: 0,
    },
    h5: {
      fontSize: rem(15),
      fontWeight: 600,
      lineHeight: 1.4,
      letterSpacing: 0,
    },
    h6: {
      fontSize: rem(14),
      fontWeight: 600,
      lineHeight: 1.45,
      letterSpacing: 0,
    },
    subtitle1: { fontSize: rem(15), fontWeight: 500, lineHeight: 1.45 },
    subtitle2: { fontSize: rem(13), fontWeight: 500, lineHeight: 1.45 },
    body1: { fontSize: rem(14), lineHeight: 1.5 },
    body2: { fontSize: rem(13), lineHeight: 1.45 },
    button: {
      fontSize: rem(14),
      fontWeight: 500,
      textTransform: 'none',
      letterSpacing: 0,
    },
    caption: { fontSize: rem(12), lineHeight: 1.5 },
    // Retired from use by the plan; kept at the caption size until the
    // remaining uses are gone.
    overline: { fontSize: rem(12) },
  },
  components: {
    MuiButton: {
      // Contained is for a page's one primary action, and is always explicit.
      defaultProps: {
        variant: 'outlined',
        disableElevation: true,
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none' },
      },
    },
    MuiTooltip: {
      defaultProps: {
        enterDelay: 400,
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        // A flat surface gets a border instead of a shadow. Surfaces that ask
        // for an elevation (the app bar, the drawer, menus, dialogs) keep
        // their shadow and get no border.
        root: ({ theme }) => ({
          variants: [
            {
              props: { variant: 'elevation', elevation: 0 },
              style: {
                border: `1px solid ${(theme.vars || theme).palette.divider}`,
              },
            },
            {
              props: { square: false },
              style: { borderRadius: SurfaceRadius },
            },
          ],
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          variants: [
            {
              props: { fullScreen: false },
              style: { borderRadius: SurfaceRadius },
            },
          ],
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        // Alerts are flat Paper but carry their own colour; only the outlined
        // variant draws a border (its own).
        root: {
          variants: [
            { props: { variant: 'standard' }, style: { border: 0 } },
            { props: { variant: 'filled' }, style: { border: 0 } },
          ],
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontSize: rem(12.5),
          color: (theme.vars || theme).palette.text.secondary,
          maxWidth: '72ch',
        }),
      },
    },
    MuiTableCell: {
      styleOverrides: {
        // Times, durations and channel numbers line up in columns.
        root: { fontVariantNumeric: 'tabular-nums' },
      },
    },
  },
});
