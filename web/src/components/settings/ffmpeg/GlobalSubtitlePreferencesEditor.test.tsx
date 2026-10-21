import { renderWithProviders, screen, within } from '@/test/utils';
import type { FfmpegSettings } from '@tunarr/types';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { GlobalSubtitlePreferencesEditor } from './GlobalSubtitlePreferencesEditor.tsx';

function Editor() {
  const [preferences, setPreferences] = useState<
    FfmpegSettings['subtitlePreferences']
  >([]);
  return (
    <GlobalSubtitlePreferencesEditor
      value={preferences}
      onChange={setPreferences}
    />
  );
}

test('ordered rows retain their filter and flags when moved or removed', async () => {
  const { user } = renderWithProviders(<Editor />);
  const add = screen.getByRole('combobox', { name: 'Add subtitle language' });
  for (const language of ['English', 'French']) {
    await user.click(add);
    await user.click(await screen.findByRole('option', { name: language }));
  }
  const row = (priority: number) =>
    within(
      screen.getByRole('group', { name: `Subtitle preference ${priority}` }),
    );
  expect(
    screen.getByRole('button', { name: 'Move subtitle preference 1 up' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Move subtitle preference 2 down' }),
  ).toBeDisabled();
  await user.click(row(2).getByRole('combobox', { name: 'Filter' }));
  await user.click(await screen.findByRole('option', { name: 'Forced' }));
  await user.click(
    row(2).getByRole('checkbox', { name: 'Allow external subtitles' }),
  );
  await user.click(
    row(2).getByRole('checkbox', { name: 'Allow image-based subtitles' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Move subtitle preference 2 up' }),
  );
  expect(row(1).getByRole('combobox', { name: 'Language' })).toHaveValue(
    'French',
  );
  expect(row(1).getByRole('combobox', { name: 'Filter' })).toHaveTextContent(
    'Forced',
  );
  expect(
    row(1).getByRole('checkbox', { name: 'Allow external subtitles' }),
  ).not.toBeChecked();
  expect(
    row(1).getByRole('checkbox', { name: 'Allow image-based subtitles' }),
  ).not.toBeChecked();
  await user.click(
    screen.getByRole('button', { name: 'Move subtitle preference 1 down' }),
  );
  expect(row(2).getByRole('combobox', { name: 'Language' })).toHaveValue(
    'French',
  );
  await user.click(
    screen.getByRole('button', { name: 'Remove subtitle preference 1' }),
  );
  expect(row(1).getByRole('combobox', { name: 'Language' })).toHaveValue(
    'French',
  );
  await user.click(row(1).getByRole('combobox', { name: 'Language' }));
  await user.click(await screen.findByRole('option', { name: 'German' }));
  expect(row(1).getByRole('combobox', { name: 'Language' })).toHaveValue(
    'German',
  );
  await user.click(row(1).getByRole('combobox', { name: 'Filter' }));
  await user.click(await screen.findByRole('option', { name: 'None' }));
  expect(row(1).getByRole('combobox', { name: 'Filter' })).toHaveTextContent(
    'None',
  );
  await user.click(
    screen.getByRole('button', { name: 'Clear subtitle preferences' }),
  );
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(
    screen.getByText(/No global subtitle preferences/),
  ).toBeInTheDocument();
});
