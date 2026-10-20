import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import { save, saveButton, savedSettings } from './settingsForm.ts';

// The Transcoding page's global FFmpeg settings: a change saves, survives a
// reload and moves nothing else.

const SETTINGS_URL = `${SERVER_URL}/api/ffmpeg-settings`;

test('a changed tone-map curve saves, survives a reload and moves nothing else', async ({
  page,
}) => {
  const before = await savedSettings<Record<string, unknown>>(
    page,
    SETTINGS_URL,
  );
  await page.goto('/web/settings/ffmpeg');
  const curve = page.getByRole('combobox', { name: 'HDR tone-map curve' });
  await expect(curve).toHaveText('Hable');
  await expect(saveButton(page)).toBeDisabled();

  await curve.click();
  await page.getByRole('option', { name: 'BT.2390', exact: true }).click();
  await save(page, SETTINGS_URL);

  await page.reload();
  await expect(curve).toHaveText('BT.2390');
  expect(await savedSettings(page, SETTINGS_URL)).toEqual({
    ...before,
    tonemapAlgorithm: 'bt2390',
  });
});
