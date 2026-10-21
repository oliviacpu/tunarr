import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { SaveableChannel } from '@tunarr/types';
import { FormProvider, useForm } from 'react-hook-form';
import { expect, test, vi } from 'vitest';
import { ChannelSubtitlePreferencesTable } from './ChannelSubtitlePreferencesTable.tsx';

function Harness({ onSave }: { onSave: (data: SaveableChannel) => void }) {
  const form = useForm<SaveableChannel>({
    defaultValues: {
      subtitlePreferenceMode: 'inherit',
      subtitlePreferences: [
        {
          langugeCode: 'eng',
          priority: 0,
          filter: 'forced',
          allowExternal: true,
          allowImageBased: false,
        },
      ],
    },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSave)}>
        <ChannelSubtitlePreferencesTable />
        <button type="submit">Save</button>
      </form>
    </FormProvider>
  );
}

test('an intentional table edit selects custom and retains the edited flags', async () => {
  const onSave = vi.fn();
  const { user } = renderWithProviders(<Harness onSave={onSave} />);
  const checkbox = screen.getAllByRole('checkbox')[0];
  if (!checkbox) throw new Error('Expected an external-subtitle checkbox');
  await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({
    subtitlePreferenceMode: 'custom',
    subtitlePreferences: [
      { langugeCode: 'eng', allowExternal: false, allowImageBased: false },
    ],
  });
});

test('removing the final custom row explicitly selects custom with an empty list', async () => {
  const onSave = vi.fn();
  const { user } = renderWithProviders(<Harness onSave={onSave} />);
  await user.click(
    screen.getByRole('button', { name: 'Remove subtitle preference' }),
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({
    subtitlePreferenceMode: 'custom',
    subtitlePreferences: [],
  });
});
