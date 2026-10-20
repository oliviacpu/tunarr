import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import { readFixtureIds } from './routes.ts';
import { savedSettings } from './settingsForm.ts';

const tabs = [
  ['General', 'general'],
  ['Playback', 'playback'],
  ['Captions & audio', 'captions-audio'],
  ['Guide', 'guide'],
  ['Tuner', 'tuner'],
  ['Library', 'library'],
  ['Experimental', 'experimental'],
] as const;

test('settings tabs match their routes, headings, and descriptions', async ({
  page,
}) => {
  for (const [name, path] of tabs) {
    await page.goto(`/web/settings/${path}`);
    await expect(page.getByRole('tab')).toHaveText(
      tabs.map(([label]) => label),
    );
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const heading = page.getByRole('heading', { level: 2, name, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading.locator('..').locator('p')).not.toBeEmpty();
  }
});

test('legacy settings and transcode-config bookmarks redirect', async ({
  page,
}) => {
  const redirects: [string, string][] = [
    ['', 'general'],
    ['/', 'general'],
    ['/ffmpeg', 'playback'],
    ['/xmltv', 'guide'],
    ['/hdhr', 'tuner'],
    ['/scanner', 'library'],
    ['/features', 'experimental'],
    ['/ffmpeg/new', 'playback/new'],
    [
      `/ffmpeg/${readFixtureIds().transcodeConfigId}`,
      `playback/${readFixtureIds().transcodeConfigId}`,
    ],
  ];
  for (const [oldPath, newPath] of redirects) {
    await page.goto(`/web/settings${oldPath}`);
    await expect(page).toHaveURL(new RegExp(`/web/settings/${newPath}$`));
  }
});

test('caption settings save and reload without changing playback', async ({
  page,
}) => {
  const url = `${SERVER_URL}/api/ffmpeg-settings`;
  const before = await savedSettings<Record<string, unknown>>(page, url);
  try {
    await page.goto('/web/settings/captions-audio');
    await expect(page.getByLabel('FFmpeg executable path')).toHaveCount(0);
    const extraction = page.getByRole('checkbox', {
      name: 'Extract embedded subtitles',
      exact: true,
    });
    const form = extraction.locator('xpath=ancestor::form');
    await extraction.setChecked(!before.enableSubtitleExtraction);
    const response = page.waitForResponse(
      (res) => res.url() === url && res.request().method() === 'PUT',
    );
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(
      form.getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(extraction).toBeChecked({
      checked: !before.enableSubtitleExtraction,
    });
    expect(await savedSettings(page, url)).toEqual({
      ...before,
      enableSubtitleExtraction: !before.enableSubtitleExtraction,
    });
  } finally {
    expect((await page.request.put(url, { data: before })).ok()).toBe(true);
  }
});

test('playback flags and captions are in their task tabs', async ({ page }) => {
  await page.goto('/web/settings/playback');
  await expect(
    page.getByRole('combobox', { name: 'HDR tone-map curve' }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'HDR Tonemapping', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Extract embedded subtitles' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'XMLTV Credit Images' }),
  ).toHaveCount(0);
  await page.goto('/web/settings/captions-audio');
  await expect(
    page.getByRole('checkbox', { name: 'WebVTT Sidecar Subtitles' }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'HDR Tonemapping', exact: true }),
  ).toHaveCount(0);
  await page.goto('/web/settings/experimental');
  await expect(
    page.getByRole('checkbox', { name: 'XMLTV Credit Images' }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'HDR Tonemapping', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'WebVTT Sidecar Subtitles' }),
  ).toHaveCount(0);
});

test('changing task tabs protects an unsaved caption edit', async ({
  page,
}) => {
  await page.goto('/web/settings/captions-audio');
  const extraction = page.getByRole('checkbox', {
    name: 'Extract embedded subtitles',
    exact: true,
  });
  const original = await extraction.isChecked();
  await extraction.setChecked(!original);
  await page.getByRole('tab', { name: 'Playback', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/captions-audio$/);
  await expect(extraction).toBeChecked({ checked: !original });
  await page.getByRole('tab', { name: 'Playback', exact: true }).click();
  await dialog.getByRole('button', { name: 'Proceed', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/playback$/);
  await page
    .getByRole('tab', { name: 'Captions & audio', exact: true })
    .click();
  await expect(extraction).toBeChecked({ checked: original });
});

test('settings remain usable at desktop and phone widths in both themes', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, path] of tabs) {
        await page.goto(`/web/settings/${path}`);
        const tab = page.getByRole('tab', { name, exact: true });
        await tab.scrollIntoViewIfNeeded();
        await expect(tab).toBeVisible();
        await expect(
          page.getByRole('heading', { level: 2, name, exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        const screenshot = testInfo.outputPath(
          `${path}-${width}-${colorScheme}.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach(`${name} ${width} ${colorScheme}`, {
          path: screenshot,
          contentType: 'image/png',
        });
      }
    }
  }
});
