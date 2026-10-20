import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// Shared steps for the settings round-trip specs: each loads a settings page,
// changes one field, saves, reloads, and checks the server kept that change
// and nothing else.

// What the server has saved, read straight from its API
export const savedSettings = async <T>(page: Page, url: string) => {
  const res = await page.request.get(url);
  expect(res.ok()).toBe(true);
  return (await res.json()) as T;
};

export const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true });

// Presses Save and waits for the server to accept the settings
export const save = async (page: Page, url: string) => {
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && res.url() === url,
  );
  await saveButton(page).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
};
