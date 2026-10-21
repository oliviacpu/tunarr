import { useLanguageOptions } from '@/hooks/useLanguagePreferences.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowDownward, ArrowUpward, Delete } from '@mui/icons-material';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { FfmpegSettings, SubtitleFilter } from '@tunarr/types';
import { SubtitleFilterSchema } from '@tunarr/types/schemas';
import { useId, useState } from 'react';

type Preference = FfmpegSettings['subtitlePreferences'][number];

export function GlobalSubtitlePreferencesEditor({
  value,
  onChange,
}: {
  value: Preference[];
  onChange: (value: Preference[]) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const [addLanguageInput, setAddLanguageInput] = useState('');
  const languages = useLanguageOptions();
  const filterNames: Record<SubtitleFilter, string> = {
    any: t`Any`,
    forced: t`Forced`,
    default: t`Default`,
    none: t`None`,
  };
  const update = (index: number, changes: Partial<Preference>) =>
    onChange(
      value.map((preference, i) =>
        i === index ? { ...preference, ...changes } : preference,
      ),
    );
  const move = (from: number, to: number) => {
    const next = [...value];
    const [preference] = next.splice(from, 1);
    if (preference === undefined) return;
    next.splice(to, 0, preference);
    onChange(next);
  };

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      {value.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          <Trans>
            No global subtitle preferences. Channels that inherit keep their
            existing fallback.
          </Trans>
        </Typography>
      )}
      {value.map((preference, index) => {
        const priority = index + 1;
        const selectedLanguage = languages.find(
          (language) => language.iso6392 === preference.languageCode,
        ) ?? {
          iso6391: '',
          iso6392: preference.languageCode,
          displayName: preference.languageCode,
        };
        return (
          <Box
            key={index}
            role="group"
            aria-label={t`Subtitle preference ${priority}`}
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
          >
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center">
                <Typography sx={{ flex: 1 }}>
                  <Trans>Preference {priority}</Trans>
                </Typography>
                <IconButton
                  aria-label={t`Move subtitle preference ${priority} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUpward />
                </IconButton>
                <IconButton
                  aria-label={t`Move subtitle preference ${priority} down`}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDownward />
                </IconButton>
                <IconButton
                  aria-label={t`Remove subtitle preference ${priority}`}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <Delete />
                </IconButton>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Autocomplete
                  fullWidth
                  disableClearable
                  options={languages}
                  value={selectedLanguage}
                  getOptionLabel={(language) => language.displayName}
                  isOptionEqualToValue={(option, selected) =>
                    option.iso6392 === selected.iso6392
                  }
                  openText={t`Open`}
                  closeText={t`Close`}
                  noOptionsText={t`No languages found`}
                  onChange={(_, language) =>
                    update(index, { languageCode: language.iso6392 })
                  }
                  renderInput={(params) => (
                    <TextField {...params} label={t`Language`} />
                  )}
                />
                <TextField
                  id={`${id}-filter-${index}`}
                  select
                  fullWidth
                  label={t`Filter`}
                  value={preference.filter}
                  onChange={(event) => {
                    const filter = SubtitleFilterSchema.safeParse(
                      event.target.value,
                    );
                    if (filter.success) update(index, { filter: filter.data });
                  }}
                >
                  {SubtitleFilterSchema.options.map((filter) => (
                    <MenuItem key={filter} value={filter}>
                      {filterNames[filter]}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} useFlexGap>
                <FormControlLabel
                  label={t`Allow external subtitles`}
                  control={
                    <Checkbox
                      checked={preference.allowExternal}
                      onChange={(_, allowExternal) =>
                        update(index, { allowExternal })
                      }
                    />
                  }
                />
                <FormControlLabel
                  label={t`Allow image-based subtitles`}
                  control={
                    <Checkbox
                      checked={preference.allowImageBased}
                      onChange={(_, allowImageBased) =>
                        update(index, { allowImageBased })
                      }
                    />
                  }
                />
              </Stack>
            </Stack>
          </Box>
        );
      })}
      <Autocomplete
        fullWidth
        value={null}
        inputValue={addLanguageInput}
        onInputChange={(_, input, reason) => {
          if (reason === 'input' || reason === 'clear') {
            setAddLanguageInput(input);
          }
        }}
        options={languages}
        getOptionLabel={(language) => language.displayName}
        openText={t`Open`}
        closeText={t`Close`}
        clearText={t`Clear`}
        noOptionsText={t`No languages found`}
        onChange={(_, language) => {
          if (language === null) return;
          setAddLanguageInput('');
          onChange([
            ...value,
            {
              languageCode: language.iso6392,
              filter: 'any',
              allowExternal: true,
              allowImageBased: true,
            },
          ]);
        }}
        renderInput={(params) => (
          <TextField {...params} label={t`Add subtitle language`} />
        )}
      />
      {value.length > 0 && (
        <Button
          variant="outlined"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => onChange([])}
        >
          <Trans>Clear subtitle preferences</Trans>
        </Button>
      )}
    </Stack>
  );
}
