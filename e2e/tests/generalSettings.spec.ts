import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import {
  save as saveSettings,
  saveButton,
  savedSettings,
} from './settingsForm.ts';

// The General page. Every save sends the whole of the system settings, so the
// tests here run one at a time: run alongside each other, one save would put
// back what another just changed.

test.describe.configure({ mode: 'serial' });

const SETTINGS_URL = `${SERVER_URL}/api/system/settings`;

type SystemSettings = {
  logging: { categoryLogLevel?: Record<string, string | null> };
};

test('a changed category log level saves, survives a reload and moves nothing else', async ({
  page,
}) => {
  const before = await savedSettings<SystemSettings>(page, SETTINGS_URL);
  await page.goto('/web/settings/general');
  const streaming = page.getByRole('combobox', {
    name: 'Streaming log level',
  });
  await expect(streaming).toHaveText('Inherit default');
  await expect(saveButton(page)).toBeDisabled();

  await streaming.click();
  await page.getByRole('option', { name: 'debug', exact: true }).click();
  await saveSettings(page, SETTINGS_URL);

  await page.reload();
  await expect(streaming).toHaveText('debug');
  expect(await savedSettings(page, SETTINGS_URL)).toEqual({
    ...before,
    logging: {
      ...before.logging,
      categoryLogLevel: {
        ...before.logging.categoryLogLevel,
        streaming: 'debug',
      },
    },
  });
});

// Each log roll option must save and survive a reload on its own.
// Unticking the schedule used to fail validation silently, so Save did nothing.

const FIFTY_MB = 50 * 1024 * 1024;

const schedule = (page: Page) => page.getByLabel('Roll on schedule');
const size = (page: Page) => page.getByLabel('Roll based on size');
const sizeField = (page: Page) => page.getByLabel('Max file size (bytes)');

const open = async (page: Page) => {
  await page.goto('/web/settings/general');
  await expect(page.getByLabel('Enable log file rolling')).toBeChecked();
};

const save = async (page: Page) => {
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      res.url().endsWith('/api/system/settings'),
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).ok()).toBe(true);
};

const savedLogRollConfig = async (page: Page) => {
  const res = await page.request.get(`${SERVER_URL}/api/system/settings`);
  const body = (await res.json()) as {
    logging: {
      logRollConfig: {
        maxFileSizeBytes?: number;
        schedule?: { increment: number; unit: string };
      };
    };
  };
  return body.logging.logRollConfig;
};

test('unticking the schedule saves and keeps the size limit', async ({
  page,
}) => {
  await open(page);
  await schedule(page).uncheck();
  await save(page);

  await page.reload();
  await expect(schedule(page)).not.toBeChecked();
  await expect(size(page)).toBeChecked();
  await expect(sizeField(page)).toHaveValue(String(FIFTY_MB));

  const config = await savedLogRollConfig(page);
  expect(config.schedule).toBeUndefined();
  expect(config.maxFileSizeBytes).toBe(FIFTY_MB);
});

test('unticking size saves while the schedule stays on', async ({ page }) => {
  await open(page);
  await schedule(page).check();
  await size(page).uncheck();
  await save(page);

  await page.reload();
  await expect(schedule(page)).toBeChecked();
  await expect(size(page)).not.toBeChecked();

  const config = await savedLogRollConfig(page);
  expect(config.schedule?.increment).toBe(1);
  expect(config.maxFileSizeBytes).toBeUndefined();
});

test('toggling size keeps an hourly schedule', async ({ page }) => {
  await open(page);
  await schedule(page).check();
  await page
    .getByRole('combobox')
    .filter({ hasText: /^Days?$/ })
    .click();
  await page.getByRole('option', { name: 'Hour' }).click();
  await size(page).check();
  await save(page);

  await page.reload();
  await expect(
    page.getByRole('combobox').filter({ hasText: /^Hours?$/ }),
  ).toBeVisible();

  const config = await savedLogRollConfig(page);
  expect(config.schedule?.unit).toBe('hour');
  expect(config.maxFileSizeBytes).toBe(FIFTY_MB);
});

test('ticking size fills in 50 MB', async ({ page }) => {
  await open(page);
  await size(page).check();
  await expect(sizeField(page)).toHaveValue(String(FIFTY_MB));
});
