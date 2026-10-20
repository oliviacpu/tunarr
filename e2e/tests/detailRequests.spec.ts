import type { Request } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { readFixtureIds } from './routes.ts';

test('successful detail visits perform one existence lookup per navigation', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const ids = readFixtureIds();
  const targets = [
    {
      path: `/library/smart_collections/${ids.smartCollectionId}`,
      api: `/api/smart_collections/${ids.smartCollectionId}`,
      heading: /^Smart Collection:/,
    },
    {
      path: `/media_sources/${ids.mediaSourceId}`,
      api: `/api/media-sources/${ids.mediaSourceId}`,
      heading: /^Media Source:/,
    },
    {
      path: `/media_sources/${ids.mediaSourceId}/libraries/${ids.libraryId}`,
      api: `/api/media-libraries/${ids.libraryId}`,
      heading: /^Library:/,
    },
    {
      path: `/settings/ffmpeg/${ids.transcodeConfigId}`,
      api: `/api/transcode_configs/${ids.transcodeConfigId}`,
      heading: /^Edit transcode config:/,
    },
    {
      path: `/media/movie/${ids.movieId}`,
      api: `/api/programs/${ids.movieId}`,
      heading: /^(Color Bars|Moving Gradient|Primary Colors)/,
    },
    {
      path: `/media/show/${ids.showId}`,
      api: `/api/program_groupings/${ids.showId}`,
      heading: /Test Pattern Theater/,
    },
  ];
  for (const target of targets) {
    await test.step(target.path, async () => {
      let lookups = 0;
      const count = (request: Request) => {
        if (
          request.method() === 'GET' &&
          new URL(request.url()).pathname === target.api
        )
          lookups++;
      };
      page.on('request', count);
      await page.goto(`/web${target.path}`);
      for (const visit of [1, 2]) {
        await expect(
          page.getByRole('heading', { name: target.heading }).last(),
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Channels', exact: true })
          .first()
          .click();
        await expect(
          page.getByRole('heading', { name: 'Channels', exact: true }),
        ).toBeVisible();
        expect(lookups).toBe(visit);
        if (visit === 1) await page.goBack();
      }
      page.off('request', count);
    });
  }
});
