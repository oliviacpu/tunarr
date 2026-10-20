import { expect, test } from '@playwright/test';
import { readFixtureIds } from './routes.ts';

test('detail and create pages expose one document heading', async ({
  page,
}) => {
  const ids = readFixtureIds();
  const routes = [
    '/library/fillers/new',
    `/library/fillers/${ids.fillerListId}/edit`,
    '/library/custom-shows/new',
    `/library/custom-shows/${ids.customShowId}/edit`,
    `/library/smart_collections/${ids.smartCollectionId}`,
    `/media_sources/${ids.mediaSourceId}`,
    `/media_sources/${ids.mediaSourceId}/libraries/${ids.libraryId}`,
    '/settings/ffmpeg/new',
    `/settings/ffmpeg/${ids.transcodeConfigId}`,
    '/welcome',
  ];
  for (const route of routes) {
    await test.step(route, async () => {
      await page.goto(`/web${route}`);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).not.toHaveText('');
      if (
        route.startsWith('/library/fillers/') ||
        route.startsWith('/library/custom-shows/')
      ) {
        await expect(
          page.getByRole('heading', {
            level: 2,
            name: 'Programming',
            exact: true,
          }),
        ).toBeVisible();
      }
      if (route === '/welcome') {
        for (const title of [
          'Connect Media Sources',
          'Install FFmpeg',
          "You're All Set!",
        ]) {
          await expect(
            page.getByRole('heading', { level: 2, name: title, exact: true }),
          ).toBeVisible();
          if (title !== "You're All Set!")
            await page
              .getByRole('button', { name: 'Next', exact: true })
              .click();
        }
      }
    });
  }
});

test('guide, search and media details keep one task selected', async ({
  page,
}) => {
  const ids = readFixtureIds();
  await page.route('**/api/system/migration-state', async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Expected migration state object');
    }
    await route.fulfill({
      response,
      json: { ...body, isFreshSettings: false },
    });
  });
  for (const [path, section] of [
    ['/', 'Guide'],
    ['/search', 'Library'],
    [`/media/movie/${ids.movieId}`, 'Library'],
  ] as const) {
    await page.goto(`/web${path}`);
    const selected = page.locator('.MuiDrawer-paper .Mui-selected');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveText(section);
  }
});

test('new transcode config breadcrumbs link to settings and playback', async ({
  page,
}) => {
  await page.goto('/web/settings/ffmpeg/new');
  const breadcrumbs = page.getByRole('navigation', { name: 'breadcrumbs' });
  await expect(
    breadcrumbs.getByRole('link', { name: 'Settings', exact: true }),
  ).toHaveAttribute('href', '/web/settings');
  await expect(
    breadcrumbs.getByRole('link', { name: 'Playback', exact: true }),
  ).toHaveAttribute('href', '/web/settings/playback');
  await expect(
    breadcrumbs.getByText('New transcode config', { exact: true }),
  ).toBeVisible();
});

test('mobile overflow is a named menu and detail headings fit both schemes', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const dark of [false, true]) {
      await page.goto('/web/settings/ffmpeg/new');
      await expect(
        page.getByRole('button', { name: /Enable (light|dark) Mode/ }),
      ).toBeVisible();
      const toggle = page.getByRole('button', {
        name: dark ? 'Enable dark Mode' : 'Enable light Mode',
        exact: true,
      });
      if (await toggle.isVisible()) await toggle.click();
      await expect(
        page.getByRole('button', {
          name: dark ? 'Enable light Mode' : 'Enable dark Mode',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 2, name: 'New transcode config' }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `transcode-${width}-${dark ? 'dark' : 'light'}.png`,
        ),
        fullPage: true,
        animations: 'disabled',
      });
      if (width === 390) {
        const overflow = page.getByRole('button', { name: 'More links' });
        await overflow.click();
        await expect(
          page.getByRole('menu', { name: 'More links' }),
        ).toBeVisible();
        await expect(page.locator('#mobile-links-button')).toHaveAttribute(
          'aria-expanded',
          'true',
        );
        await page.screenshot({
          path: testInfo.outputPath(`overflow-${dark ? 'dark' : 'light'}.png`),
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
      }
    }
  }
});
