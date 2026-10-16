import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { SaveableChannel } from '@tunarr/types';
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, test, vi } from 'vitest';
import { ChannelAudioTracksField } from './ChannelAudioTracksField.tsx';

function Harness({
  audioTracks,
  disabled,
  onValid,
  onInvalid,
}: {
  audioTracks: string[];
  disabled: boolean;
  onValid: (data: Partial<SaveableChannel>) => void;
  onInvalid: (errors: object) => void;
}): ReactNode {
  const form = useForm<SaveableChannel>({
    defaultValues: { audioTracks } as SaveableChannel,
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onValid, onInvalid)}>
        <ChannelAudioTracksField disabled={disabled} />
        <button type="submit">Save</button>
      </form>
    </FormProvider>
  );
}

async function submit(audioTracks: string[], disabled: boolean) {
  const onValid = vi.fn();
  const onInvalid = vi.fn();
  const { user } = renderWithProviders(
    <Harness
      audioTracks={audioTracks}
      disabled={disabled}
      onValid={onValid}
      onInvalid={onInvalid}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(onValid.mock.calls.length + onInvalid.mock.calls.length).toBe(1),
  );
  return { onValid, onInvalid };
}

describe('ChannelAudioTracksField', () => {
  test('saves a valid layout', async () => {
    const { onValid } = await submit(['eng', 'jpn'], false);

    expect(onValid.mock.calls[0]?.[0].audioTracks).toEqual(['eng', 'jpn']);
  });

  test('refuses an unknown language code', async () => {
    const { onInvalid } = await submit(['eng', 'zzz'], false);

    expect(onInvalid).toHaveBeenCalled();
  });

  test('disabled, an invalid value neither blocks the save nor is sent', async () => {
    // HLS Direct v2 disables the field; the stored layout is kept
    const { onValid } = await submit(['eng', 'zzz'], true);

    expect(onValid).toHaveBeenCalled();
    expect(onValid.mock.calls[0]?.[0].audioTracks).toBeUndefined();
  });
});
