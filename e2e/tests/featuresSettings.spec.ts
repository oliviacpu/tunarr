import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import { save, saveButton, savedSettings } from './settingsForm.ts';

// The Features page: a switched flag saves, survives a reload and moves no
// other flag.

type FeatureFlagsResponse = {
  flags: Record<string, boolean>;
  metadata: unknown[];
};

const SETTINGS_URL = `${SERVER_URL}/api/system/feature-flags`;

test('a switched flag saves, survives a reload and moves nothing else', async ({
  page,
}) => {
  const before = await savedSettings<FeatureFlagsResponse>(page, SETTINGS_URL);
  expect(before.flags.xmltvCreditImagesEnabled).toBe(false);
  await page.goto('/web/settings/experimental');
  const flag = page.getByRole('checkbox', { name: 'XMLTV Credit Images' });
  await expect(flag).not.toBeChecked();
  await expect(saveButton(page)).toBeDisabled();

  await flag.check();
  await save(page, SETTINGS_URL);

  await page.reload();
  await expect(flag).toBeChecked();
  expect(await savedSettings(page, SETTINGS_URL)).toEqual({
    ...before,
    flags: { ...before.flags, xmltvCreditImagesEnabled: true },
  });
});
