import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';

// The transcode config page sits in the settings form shell: a new config
// saves once and opens as its own edit page, and an edited one guards
// leaving and saves to the same config.

type TranscodeConfig = {
  id: string;
  name: string;
  videoBitRate: number;
} & Record<string, unknown>;

const CONFIGS_URL = `${SERVER_URL}/api/transcode_configs`;

const savedConfigs = async (page: Page) => {
  const res = await page.request.get(CONFIGS_URL);
  return (await res.json()) as TranscodeConfig[];
};

const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true });
const nameField = (page: Page) => page.getByLabel('Name', { exact: true });
const unsavedDialog = (page: Page) =>
  page.getByText('You have unsaved changes!');

test('a new config saves once and opens as its edit page', async ({ page }) => {
  const name = `E2E new ${Date.now()}`;
  await page.goto('/web/settings/playback/new');
  await expect(
    page.getByRole('heading', { name: 'New transcode config' }),
  ).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();

  await nameField(page).fill(name);
  const created = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url() === CONFIGS_URL,
  );
  await saveButton(page).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const { id } = (await response.json()) as TranscodeConfig;

  // The guard does not stop the move to the new config's page
  await expect(page).toHaveURL(new RegExp(`/settings/playback/${id}$`));
  await expect(
    page.getByRole('heading', { name: `Edit transcode config: "${name}"` }),
  ).toBeVisible();
  await expect(unsavedDialog(page)).toBeHidden();
  await expect(saveButton(page)).toBeDisabled();

  await page.reload();
  await expect(nameField(page)).toHaveValue(name);
  expect(
    (await savedConfigs(page)).filter((config) => config.name === name),
  ).toHaveLength(1);
});

test('an edited config guards leaving and saves to the same config', async ({
  page,
}) => {
  // A config of its own, so the seeded one stays as it is
  const [seeded] = await savedConfigs(page);
  if (seeded === undefined) {
    throw new Error('The fixture has no transcode config');
  }
  const body: Record<string, unknown> = {
    ...seeded,
    name: `E2E edit ${Date.now()}`,
    isDefault: false,
  };
  delete body.id;
  const post = await page.request.post(CONFIGS_URL, { data: body });
  expect(post.ok()).toBe(true);
  const before = (await post.json()) as TranscodeConfig;

  await page.goto(`/web/settings/playback/${before.id}`);
  const bitrate = page.getByLabel('Video bitrate');
  await expect(bitrate).toHaveValue(String(before.videoBitRate));
  await expect(saveButton(page)).toBeDisabled();

  await bitrate.fill('4321');
  await expect(saveButton(page)).toBeEnabled();

  // Leaving with the change unsaved asks first
  const playbackLink = page
    .getByRole('navigation', { name: 'breadcrumbs' })
    .getByRole('link', { name: 'Playback', exact: true });
  await expect(playbackLink).toHaveAttribute('href', '/web/settings/playback');
  await playbackLink.click();
  await expect(unsavedDialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/playback/${before.id}$`));

  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      res.url() === `${CONFIGS_URL}/${before.id}`,
  );
  await saveButton(page).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();

  await page.reload();
  await expect(page.getByLabel('Video bitrate')).toHaveValue('4321');
  const after = (await savedConfigs(page)).find(
    (config) => config.id === before.id,
  );
  expect(after).toEqual({ ...before, videoBitRate: 4321 });
});
