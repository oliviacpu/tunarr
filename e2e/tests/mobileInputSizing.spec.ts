import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${width}px ${colorScheme} inputs stay readable without horizontal overflow`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      const expectedSize = width < 600 ? '16px' : '14px';
      await page.goto('/web/settings/xmltv');
      const hours = page.getByRole('textbox', { name: 'Guide length (hours)' });
      await expect(hours).toBeVisible();
      await expect(hours).toHaveCSS('font-size', expectedSize);
      const label = page.locator('label[for="epg-hours"]');
      await expect(label).toHaveCSS('font-size', expectedSize);
      await expect(
        page.getByRole('combobox', { name: 'Refreshes start at' }),
      ).toHaveCSS('font-size', expectedSize);
      if (width < 600) {
        const help = await page
          .locator('#refresh-hours-helper-text')
          .boundingBox();
        const nextLabel = await page
          .locator('label[for="refresh-start-hour"]')
          .boundingBox();
        if (help === null || nextLabel === null)
          throw new Error('Guide refresh fields did not render');
        expect(nextLabel.y).toBeGreaterThanOrEqual(help.y + help.height);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('settings-inputs.png'),
        fullPage: true,
      });
      await page.goto('/web/guide');
      const picker = page.locator('.MuiPickersInputBase-root').first();
      await expect(picker).toBeVisible();
      await expect(picker).toHaveCSS('font-size', expectedSize);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('picker-inputs.png'),
        fullPage: true,
      });
    });
  }
}
