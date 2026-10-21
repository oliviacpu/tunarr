import { act, renderWithProviders, screen, waitFor } from '@/test/utils';
import type { SaveableChannel } from '@tunarr/types';
import type { GlobalSubtitlePreference } from '@tunarr/types/schemas';
import { FormProvider, useForm, useFormContext } from 'react-hook-form';
import { beforeEach, expect, test, vi } from 'vitest';
import { ChannelSubtitlePreferencesField } from './ChannelSubtitlePreferencesField.tsx';

let globalPreferences: GlobalSubtitlePreference[] = [];
vi.mock('../../hooks/settingsHooks.ts', () => ({
  useFfmpegSettings: () => ({
    data: { subtitlePreferences: globalPreferences },
  }),
}));
vi.mock('./ChannelSubtitlePreferencesTable.tsx', () => ({
  ChannelSubtitlePreferencesTable: () => {
    const { register } = useFormContext<SaveableChannel>();
    return (
      <label>
        Custom language
        <input {...register('subtitlePreferences.0.langugeCode')} />
      </label>
    );
  },
}));

function Harness({
  mode = 'inherit',
  enabled = true,
  streamMode = 'hls',
  onSave = vi.fn(),
}: {
  mode?: 'inherit' | 'custom';
  enabled?: boolean;
  streamMode?: SaveableChannel['streamMode'];
  onSave?: (value: SaveableChannel) => void;
}) {
  const form = useForm<SaveableChannel>({
    defaultValues: {
      subtitlePreferenceMode: mode,
      subtitlesEnabled: enabled,
      streamMode,
      subtitlePreferences: [
        {
          langugeCode: 'eng',
          priority: 0,
          filter: 'any',
          allowExternal: true,
          allowImageBased: true,
        },
      ],
    },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSave)}>
        <ChannelSubtitlePreferencesField />
        <button type="submit">Save</button>
      </form>
    </FormProvider>
  );
}

beforeEach(() => {
  globalPreferences = [];
});

async function chooseMode(
  user: ReturnType<typeof renderWithProviders>['user'],
  label: string,
) {
  await user.click(
    screen.getByRole('combobox', { name: 'Subtitle preferences' }),
  );
  await user.click(screen.getByRole('option', { name: label }));
}

test('previews saved global rows in priority order with independent filters and flags', () => {
  globalPreferences = [
    {
      languageCode: 'spa',
      filter: 'forced',
      allowExternal: false,
      allowImageBased: true,
    },
    {
      languageCode: 'eng',
      filter: 'none',
      allowExternal: true,
      allowImageBased: false,
    },
  ];
  const { rerender } = renderWithProviders(<Harness />);
  const rows = screen.getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent(
    'Spanish — Forced; External excluded; Image based allowed',
  );
  expect(rows[1]).toHaveTextContent(
    'English — None (skip this row); External allowed; Image based excluded',
  );
  globalPreferences = [
    {
      languageCode: 'jpn',
      filter: 'default',
      allowExternal: true,
      allowImageBased: false,
    },
  ];
  act(() => rerender(<Harness />));
  expect(screen.getByRole('listitem')).toHaveTextContent('Japanese — Default');
  expect(screen.queryByText(/Spanish/)).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('an empty global list describes the existing stream-mode fallback', () => {
  renderWithProviders(<Harness />);
  expect(screen.getByText(/No global preferences/)).toHaveTextContent(
    "keeps its stream mode's existing subtitle fallback",
  );
});

test('mode switches retain custom drafts and never copy global rows', async () => {
  globalPreferences = [
    {
      languageCode: 'jpn',
      filter: 'any',
      allowExternal: true,
      allowImageBased: true,
    },
  ];
  const onSave = vi.fn();
  const { user } = renderWithProviders(
    <Harness mode="custom" onSave={onSave} />,
  );
  await user.clear(screen.getByRole('textbox', { name: 'Custom language' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Custom language' }),
    'spa',
  );
  await chooseMode(user, 'Use global defaults');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({
    subtitlePreferenceMode: 'inherit',
    subtitlePreferences: [{ langugeCode: 'spa' }],
  });
  await chooseMode(user, 'Customize for this channel');
  expect(screen.getByRole('textbox', { name: 'Custom language' })).toHaveValue(
    'spa',
  );
  expect(screen.getByText(/An empty list keeps/)).toHaveTextContent(
    'it does not use global defaults',
  );
});

test('disabled subtitles keep editable preferences while clearly describing inactivity', () => {
  renderWithProviders(<Harness enabled={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Subtitles are disabled for this channel',
  );
  expect(
    screen.getByRole('combobox', { name: 'Subtitle preferences' }),
  ).toBeEnabled();
});

test('HLS Direct v2 explains text-only output even when image rows are allowed', () => {
  renderWithProviders(<Harness streamMode="hls_direct_v2" />);
  expect(
    screen.getByText(/HLS Direct v2 supports text subtitles only/),
  ).toHaveTextContent('does not make them available');
  expect(
    screen.queryByText(/embedded text may need extraction/),
  ).not.toBeInTheDocument();
});
