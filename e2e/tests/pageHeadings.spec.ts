import { expect, test } from '@playwright/test';
import { readFixtureIds } from './routes.ts';

// Every top-level page opens with PageHeader, whose title is the document's
// only h1. The top bar wordmark must not be a heading.
const TOP_LEVEL_PAGES: [url: string, title: string][] = [
  ['/channels', 'Channels'],
  ['/guide', 'Guide'],
  ['/library', 'Library'],
  ['/library/fillers', 'Filler Lists'],
  ['/library/custom-shows', 'Custom Shows'],
  ['/library/smart_collections', 'Smart Collections'],
  ['/library/trash', 'Trash'],
  ['/media_sources', 'Media Sources'],
  ['/search', 'Search'],
  ['/settings/general', 'Settings'],
  ['/settings/ffmpeg', 'Settings'],
  ['/system', 'System'],
  ['/system/tasks', 'System'],
];

for (const [url, title] of TOP_LEVEL_PAGES) {
  test(`${url} has one h1, "${title}"`, async ({ page }) => {
    await page.goto(`/web${url}`);

    const h1 = page.locator('h1');
    await expect(h1).toHaveText(title);
    await expect(h1).toHaveCount(1);
  });
}

test('channel pages title themselves with the channel name', async ({
  page,
}) => {
  const [channelId] = readFixtureIds().channelIds;
  if (channelId === undefined) {
    throw new Error('Fixture has no channels');
  }

  for (const suffix of ['', '/edit', '/programming']) {
    await test.step(`/channels/${channelId}${suffix}`, async () => {
      await page.goto(`/web/channels/${channelId}${suffix}`);
      const h1 = page.locator('h1');
      await expect(h1).toHaveCount(1);
      await expect(h1).not.toHaveText('');
    });
  }
});
