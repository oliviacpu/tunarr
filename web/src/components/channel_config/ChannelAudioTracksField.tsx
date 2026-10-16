import { Trans, useLingui } from '@lingui/react/macro';
import { FormControl, FormHelperText, TextField } from '@mui/material';
import { StrictChannelAudioTracksSchema } from '@tunarr/types/schemas';
import { useEffect, useState } from 'react';
import { Controller } from 'react-hook-form';
import { parseAudioTracks } from '../../helpers/channelAudioTracks.ts';
import { useChannelFormContext } from '../../hooks/useChannelFormContext.ts';

type InputProps = {
  value: string[] | undefined;
  onChange: (value: string[]) => void;
  onBlur: () => void;
  error: string | undefined;
  disabled: boolean;
};

function AudioTracksInput({
  value,
  onChange,
  onBlur,
  error,
  disabled,
}: InputProps) {
  const { t } = useLingui();
  const joined = (value ?? []).join(', ');
  const [text, setText] = useState(joined);

  // Follow the form when it changes underneath (a reset after saving)
  useEffect(() => {
    setText((current) =>
      parseAudioTracks(current).join(', ') === joined ? current : joined,
    );
  }, [joined]);

  return (
    <TextField
      label={t`Audio tracks`}
      placeholder="eng, jpn"
      value={text}
      disabled={disabled}
      error={error !== undefined}
      onBlur={onBlur}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseAudioTracks(e.target.value));
      }}
    />
  );
}

/**
 * A channel's fixed audio track layout, for switchable audio in Plex Live TV
 * (Channel.audioTracks): language codes in output order.
 */
export function ChannelAudioTracksField({ disabled }: { disabled: boolean }) {
  const { t } = useLingui();
  const { control } = useChannelFormContext();

  return (
    <Controller
      control={control}
      name="audioTracks"
      rules={{
        validate: (value) => {
          const result = StrictChannelAudioTracksSchema.safeParse(value ?? []);
          return (
            result.success ||
            (result.error.issues[0]?.message ?? t`Invalid audio tracks`)
          );
        },
      }}
      render={({ field, fieldState }) => (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <AudioTracksInput
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            disabled={disabled}
          />
          <FormHelperText error={fieldState.error !== undefined}>
            {fieldState.error?.message ?? (
              <Trans>
                For switchable audio in Plex Live TV: up to four language codes
                (ISO 639-2, such as eng, jpn), in order. Every program, gap and
                commercial on this channel then carries exactly these audio
                tracks, so the audio menu stays the same all session, and Plex
                picks each viewer's preferred language. A program without one of
                the languages repeats its main audio there. Leave empty for one
                audio track. Not available in HLS Direct v2, which copies each
                program's own tracks.
              </Trans>
            )}
          </FormHelperText>
        </FormControl>
      )}
    />
  );
}
