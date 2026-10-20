import { Trans, useLingui } from '@lingui/react/macro';
import {
  Box,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
} from '@mui/material';
import type {
  CaptionAppearanceSettings,
  CaptionBackgroundColor,
  CaptionBackgroundOpacity,
  CaptionMode,
  CaptionOverlap,
  CaptionTextColor,
} from '@tunarr/types/schemas';
import {
  CaptionBackgroundColors,
  CaptionBackgroundOpacities,
  CaptionModes,
  CaptionOverlaps,
  CaptionTextColors,
} from '@tunarr/types/schemas';
import { map } from 'lodash-es';
import { HelpTooltip } from '../../base/HelpTooltip.tsx';

const CaptionRows = Array.from({ length: 15 }, (_, i) => i + 1);

type Props = {
  value: CaptionAppearanceSettings;
  onChange: (value: CaptionAppearanceSettings) => void;
  // Prefix for the controls' ids, so two sets can share a page
  idPrefix?: string;
};

/**
 * Every closed-caption appearance setting: text and box colours, how captions
 * appear, overlaps, lines, rows and the subtitle file's styles and placement.
 * Used for the global settings (FFmpeg settings page) and for a channel's own
 * caption look.
 */
export function CaptionAppearanceFields({
  value,
  onChange,
  idPrefix = 'caption',
}: Props) {
  const { t } = useLingui();
  const set = <K extends keyof CaptionAppearanceSettings>(
    key: K,
    next: CaptionAppearanceSettings[K],
  ) => onChange({ ...value, [key]: next });
  const rollUp = value.mode.startsWith('rollUp');

  const textColorNames: Record<CaptionTextColor, string> = {
    white: t`White`,
    green: t`Green`,
    blue: t`Blue`,
    cyan: t`Cyan`,
    red: t`Red`,
    yellow: t`Yellow`,
    magenta: t`Magenta`,
  };
  const backgroundNames: Record<CaptionBackgroundColor, string> = {
    player: t`The player's own`,
    black: t`Black`,
    white: t`White`,
    green: t`Green`,
    blue: t`Blue`,
    cyan: t`Cyan`,
    red: t`Red`,
    yellow: t`Yellow`,
    magenta: t`Magenta`,
  };
  const opacityNames: Record<CaptionBackgroundOpacity, string> = {
    opaque: t`Solid`,
    semiTransparent: t`See-through`,
    transparent: t`None (text only)`,
  };
  const modeNames: Record<CaptionMode, string> = {
    popOn: t`Pop-on (each caption appears whole)`,
    rollUp2: t`Roll-up, 2 rows`,
    rollUp3: t`Roll-up, 3 rows`,
    rollUp4: t`Roll-up, 4 rows`,
    paintOn: t`Paint-on (letters appear as they arrive)`,
  };
  const overlapNames: Record<CaptionOverlap, string> = {
    together: t`Show both, stacked`,
    apart: t`Show each where the subtitle file puts it`,
    newest: t`Show the newest`,
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FormControl fullWidth>
          <InputLabel id={`${idPrefix}-text-color-label`}>
            <Trans>Text color</Trans>
          </InputLabel>
          <Select
            label={t`Text color`}
            labelId={`${idPrefix}-text-color-label`}
            value={value.textColor}
            onChange={(e) =>
              set('textColor', e.target.value as CaptionTextColor)
            }
          >
            {map(CaptionTextColors, (color) => (
              <MenuItem key={color} value={color}>
                {textColorNames[color]}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            <Trans>Italic words are always white.</Trans>
          </FormHelperText>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id={`${idPrefix}-background-label`}>
            <Trans>Box behind the text</Trans>
          </InputLabel>
          <Select
            label={t`Box behind the text`}
            labelId={`${idPrefix}-background-label`}
            value={value.backgroundColor}
            onChange={(e) =>
              set('backgroundColor', e.target.value as CaptionBackgroundColor)
            }
          >
            {map(CaptionBackgroundColors, (color) => (
              <MenuItem key={color} value={color}>
                {backgroundNames[color]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id={`${idPrefix}-opacity-label`}>
            <Trans>Box opacity</Trans>
          </InputLabel>
          <Select
            label={t`Box opacity`}
            labelId={`${idPrefix}-opacity-label`}
            disabled={value.backgroundColor === 'player'}
            value={value.backgroundOpacity}
            onChange={(e) =>
              set(
                'backgroundOpacity',
                e.target.value as CaptionBackgroundOpacity,
              )
            }
          >
            {map(CaptionBackgroundOpacities, (opacity) => (
              <MenuItem key={opacity} value={opacity}>
                {opacityNames[opacity]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <FormControl fullWidth>
        <InputLabel id={`${idPrefix}-mode-label`}>
          <Trans>How captions appear</Trans>
        </InputLabel>
        <Select
          label={t`How captions appear`}
          labelId={`${idPrefix}-mode-label`}
          value={value.mode}
          onChange={(e) => set('mode', e.target.value as CaptionMode)}
        >
          {map(CaptionModes, (mode) => (
            <MenuItem key={mode} value={mode}>
              {modeNames[mode]}
            </MenuItem>
          ))}
        </Select>
        <FormHelperText>
          <Trans>
            Roll-up scrolls lines up from the bottom row like live TV captions,
            keeping the last lines up for up to 2 seconds between subtitles.
          </Trans>
        </FormHelperText>
      </FormControl>
      <FormControl fullWidth>
        <InputLabel id={`${idPrefix}-overlap-label`}>
          <Trans>When subtitles overlap</Trans>
        </InputLabel>
        <Select
          label={t`When subtitles overlap`}
          labelId={`${idPrefix}-overlap-label`}
          value={value.overlappingCues}
          onChange={(e) =>
            set('overlappingCues', e.target.value as CaptionOverlap)
          }
        >
          {map(CaptionOverlaps, (overlap) => (
            <MenuItem key={overlap} value={overlap}>
              {overlapNames[overlap]}
            </MenuItem>
          ))}
        </Select>
        <FormHelperText>
          <Trans>
            What shows when two subtitles are on screen at once. Roll-up and
            paint-on show them one at a time.
          </Trans>
          <HelpTooltip about={t`When subtitles overlap`}>
            <Trans>
              Stacked shows both in one block, older above newer, at the bottom
              when the file places them apart. Each where the file puts it needs
              a player that places every line; test pattern sample 38 shows
              whether yours does. Newest shows one at a time, bringing the
              earlier back when the newer ends.
            </Trans>
          </HelpTooltip>
        </FormHelperText>
      </FormControl>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FormControl fullWidth>
          <InputLabel id={`${idPrefix}-max-lines-label`}>
            <Trans>Lines per caption</Trans>
          </InputLabel>
          <Select
            label={t`Lines per caption`}
            labelId={`${idPrefix}-max-lines-label`}
            disabled={rollUp}
            value={value.maxLines}
            onChange={(e) => set('maxLines', Number(e.target.value))}
          >
            {map([2, 3, 4], (lines) => (
              <MenuItem key={lines} value={lines}>
                {lines}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id={`${idPrefix}-line-width-label`}>
            <Trans>Line width</Trans>
          </InputLabel>
          <Select
            label={t`Line width`}
            labelId={`${idPrefix}-line-width-label`}
            value={value.lineWidth}
            onChange={(e) => set('lineWidth', Number(e.target.value))}
          >
            {map([20, 22, 24, 26, 28, 30, 32], (width) => (
              <MenuItem key={width} value={width}>
                <Trans>{width} columns</Trans>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id={`${idPrefix}-bottom-row-label`}>
            <Trans>Bottom row</Trans>
          </InputLabel>
          <Select
            label={t`Bottom row`}
            labelId={`${idPrefix}-bottom-row-label`}
            value={value.bottomRow}
            onChange={(e) => set('bottomRow', Number(e.target.value))}
          >
            {map(CaptionRows, (row) => (
              <MenuItem key={row} value={row}>
                {row}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id={`${idPrefix}-top-row-label`}>
            <Trans>Top row</Trans>
          </InputLabel>
          <Select
            label={t`Top row`}
            labelId={`${idPrefix}-top-row-label`}
            disabled={rollUp || !value.keepTopPlacement}
            value={value.topRow}
            onChange={(e) => set('topRow', Number(e.target.value))}
          >
            {map(CaptionRows, (row) => (
              <MenuItem key={row} value={row}>
                {row}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <FormHelperText>
        <Trans>
          The screen has 15 caption rows, and captions end on the bottom row. A
          narrower line wraps sooner.
        </Trans>
        <HelpTooltip about={t`Caption rows`}>
          <Trans>
            Captions the subtitle file places at the top start on the top row,
            and ones it places in the middle sit between the two.
          </Trans>
        </HelpTooltip>
      </FormHelperText>
      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={value.upperCase}
              onChange={(e) => set('upperCase', e.target.checked)}
            />
          }
          label={t`All capitals`}
        />
        <FormControlLabel
          control={
            <Switch
              checked={value.keepStyles}
              onChange={(e) => set('keepStyles', e.target.checked)}
            />
          }
          label={t`Italics and underline from the subtitle file`}
        />
        <FormControlLabel
          control={
            <Switch
              checked={value.keepTopPlacement}
              onChange={(e) => set('keepTopPlacement', e.target.checked)}
            />
          }
          label={t`Placement from the subtitle file (top, middle, sides)`}
        />
      </Box>
    </Stack>
  );
}
