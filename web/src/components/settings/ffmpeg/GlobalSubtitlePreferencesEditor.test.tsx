import { renderWithProviders, screen, within } from '@/test/utils';
import type { FfmpegSettings } from '@tunarr/types';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { GlobalSubtitlePreferencesEditor } from './GlobalSubtitlePreferencesEditor.tsx';

type Preferences = FfmpegSettings['subtitlePreferences'];

function Editor({
  initialPreferences = [],
}: {
  initialPreferences?: Preferences;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  return (
    <GlobalSubtitlePreferencesEditor
      value={preferences}
      onChange={setPreferences}
    />
  );
}

function option(name: string) {
  return within(screen.getByRole('listbox')).getByRole('option', {
    name,
  });
}

function languageOption(name: string) {
  expect(
    within(screen.getByRole('listbox')).getAllByRole('option'),
  ).toHaveLength(1);
  return option(name);
}

test('adds, changes, and clears subtitle languages from the catalogue', async () => {
  const { user, container } = renderWithProviders(<Editor />);
  const editor = within(container);
  const add = editor.getByRole('combobox', { name: 'Add subtitle language' });
  await user.tab();
  for (const language of ['English', 'French']) {
    expect(add).toHaveFocus();
    await user.paste(language);
    await user.click(languageOption(language));
  }
  const firstRow = within(editor.getByLabelText('Subtitle preference 1'));
  const secondRow = within(editor.getByLabelText('Subtitle preference 2'));
  expect(firstRow.getByLabelText('Language')).toHaveValue('English');
  const language = secondRow.getByLabelText('Language');
  expect(language).toHaveValue('French');
  await user.click(language);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste('German');
  await user.click(languageOption('German'));
  expect(secondRow.getByLabelText('Language')).toHaveValue('German');
  await user.click(secondRow.getByRole('combobox', { name: 'Filter' }));
  await user.click(option('None'));
  expect(secondRow.getByRole('combobox', { name: 'Filter' })).toHaveTextContent(
    'None',
  );
  await user.click(
    editor.getByRole('button', { name: 'Clear subtitle preferences' }),
  );
  expect(editor.queryByRole('group')).not.toBeInTheDocument();
  expect(
    editor.getByText(/No global subtitle preferences/),
  ).toBeInTheDocument();
});

test('ordered rows retain their filter and flags when moved or removed', async () => {
  const { user, container } = renderWithProviders(
    <Editor
      initialPreferences={['eng', 'fra'].map((languageCode) => ({
        languageCode,
        filter: 'any',
        allowExternal: true,
        allowImageBased: true,
      }))}
    />,
  );
  const editor = within(container);
  const row = (priority: number) =>
    within(editor.getByLabelText(`Subtitle preference ${priority}`));
  expect(row(1).getByLabelText('Move subtitle preference 1 up')).toBeDisabled();
  expect(
    row(2).getByLabelText('Move subtitle preference 2 down'),
  ).toBeDisabled();
  await user.click(row(2).getByRole('combobox', { name: 'Filter' }));
  await user.click(option('Forced'));
  await user.click(row(2).getByLabelText('Allow external subtitles'));
  await user.click(row(2).getByLabelText('Allow image-based subtitles'));
  await user.click(row(2).getByLabelText('Move subtitle preference 2 up'));
  expect(row(1).getByLabelText('Language')).toHaveValue('French');
  expect(row(1).getByRole('combobox', { name: 'Filter' })).toHaveTextContent(
    'Forced',
  );
  expect(row(1).getByLabelText('Allow external subtitles')).not.toBeChecked();
  expect(
    row(1).getByLabelText('Allow image-based subtitles'),
  ).not.toBeChecked();
  await user.click(row(1).getByLabelText('Move subtitle preference 1 down'));
  expect(row(2).getByLabelText('Language')).toHaveValue('French');
  await user.click(row(1).getByLabelText('Remove subtitle preference 1'));
  expect(row(1).getByLabelText('Language')).toHaveValue('French');
  expect(row(1).getByRole('combobox', { name: 'Filter' })).toHaveTextContent(
    'Forced',
  );
  expect(row(1).getByLabelText('Allow external subtitles')).not.toBeChecked();
  expect(
    row(1).getByLabelText('Allow image-based subtitles'),
  ).not.toBeChecked();
  expect(editor.getAllByRole('group')).toHaveLength(1);
});
