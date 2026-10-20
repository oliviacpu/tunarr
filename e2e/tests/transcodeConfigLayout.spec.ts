import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${width}px ${colorScheme} transcode fields fit their page`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto('/web/settings/ffmpeg/new');
      const name = page.getByRole('textbox', { name: 'Name', exact: true });
      const threads = page.getByRole('textbox', {
        name: 'Threads',
        exact: true,
      });
      await expect(name).toBeVisible();
      await expect(threads).toBeVisible();
      if (width < 600) {
        const nameBox = await name.boundingBox();
        const threadsBox = await threads.boundingBox();
        if (nameBox === null || threadsBox === null)
          throw new Error('Transcode fields did not render');
        expect(nameBox.width).toBeGreaterThan(width * 0.65);
        expect(threadsBox.width).toBeGreaterThan(width * 0.65);
        expect(threadsBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('transcode-layout.png'),
        fullPage: true,
      });
    });
  }
}
