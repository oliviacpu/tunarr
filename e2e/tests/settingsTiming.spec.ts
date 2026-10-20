import { expect, test } from '@playwright/test';
import { SettingsApplicationTiming } from '../../types/src/SettingsApplicationTiming.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

const groups = {
  general: [
    'browserPreferences',
    'serverPort',
    'backendAddress',
    'logging',
    'backups',
  ],
  playback: [
    'ffmpegBinaries',
    'ffmpegLogging',
    'hlsDirectOutput',
    'videoFilters',
    'readAhead',
    'hlsSession',
    'transcodeDirectory',
    'transcodeConfigs',
    'feature.tonemapEnabled',
    'feature.disableVulkan',
    'feature.disableVaapiPad',
  ],
  'captions-audio': [
    'subtitleExtraction',
    'captionsEnabled',
    'captionStyle',
    'audioLanguages',
    'feature.webvttSidecarEnabled',
  ],
  guide: ['guide'],
  tuner: ['tunerDiscovery', 'tunerCount'],
  library: ['scanner', 'search'],
  experimental: [
    'feature.proxyArtwork',
    'feature.xmltvCreditImagesEnabled',
    'feature.disableSearchSnapshotInBackup',
  ],
};

test('all settings groups expose their application timing at both widths and themes', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const known: RegExp[] = [];
  const health = watchPageHealth(page, known);
  expect(Object.values(groups).flat().sort()).toEqual(
    Object.keys(SettingsApplicationTiming).sort(),
  );
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [route, settings] of Object.entries(groups)) {
        known.splice(0, known.length, ...knownIssuesFor(`/settings/${route}`));
        await page.goto(`/web/settings/${route}`);
        await health.settle();
        for (const setting of settings)
          await expect(
            page.locator(`[data-settings-timing="${setting}"]`),
          ).toHaveCount(1);
        await expect(
          page.getByRole('button', { name: 'Save', exact: true }).first(),
        ).toBeDisabled();
        await page
          .locator('[role="tab"][aria-selected="true"]')
          .scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        const screenshot = testInfo.outputPath(
          `${route}-${width}-${colorScheme}.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach(`${route} ${width} ${colorScheme}`, {
          path: screenshot,
          contentType: 'image/png',
        });
      }
    }
  }
  known.splice(
    0,
    known.length,
    ...knownIssuesFor('/settings/playback/$configId'),
  );
  await page.goto(
    `/web/settings/playback/${readFixtureIds().transcodeConfigId}`,
  );
  await health.settle();
  await expect(
    page.locator('[data-settings-timing="transcodeConfigs"]'),
  ).toBeVisible();
  const chip = page.locator('[data-settings-timing="transcodeConfigs"]');
  await chip.focus();
  await expect(page.getByRole('tooltip')).toContainText(
    'Active HLS sessions retain',
  );
  expect(health.problems).toEqual([]);
});
