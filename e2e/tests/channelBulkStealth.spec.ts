import { expect, test } from '@playwright/test';
import type { GetChannelsByNumberV2Response as Channel } from '../../web/src/generated/types.gen.ts';
import { api } from '../fixture/api.ts';
import { SERVER_URL } from '../fixture/env.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

test('batched guide visibility persists without whole-channel writes', async ({
  page,
}, testInfo) => {
  const ids = readFixtureIds().channelIds.slice(0, 2);
  expect(ids).toHaveLength(2);
  const original = await Promise.all(
    ids.map((id) => api<Channel>('GET', `/channels/${id}`)),
  );
  const requests: { path: string; method: string; body: unknown }[] = [];
  const health = watchPageHealth(page, knownIssuesFor('/channels'));
  const selected = page.getByRole('group', { name: 'Selected rows' });
  const selectChannels = async () => {
    for (const channel of original) {
      const row = page.getByRole('row').filter({
        has: page.getByRole('cell', { name: channel.name, exact: true }),
      });
      await row.getByRole('checkbox').check();
    }
    await expect(selected).toContainText('2 selected');
  };

  try {
    await api('POST', '/channels/bulk/stealth', { ids, stealth: false });
    const before = await Promise.all(
      ids.map((id) => api<Channel>('GET', `/channels/${id}`)),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/web/channels');
    await expect(
      page.getByRole('heading', { name: 'Channels', exact: true }),
    ).toBeVisible();
    page.on('request', (request) => {
      if (['POST', 'PUT', 'DELETE'].includes(request.method())) {
        requests.push({
          path: new URL(request.url()).pathname,
          method: request.method(),
          body: request.postDataJSON(),
        });
      }
    });
    await selectChannels();
    await page.screenshot({
      path: testInfo.outputPath('before-hide.png'),
      fullPage: true,
    });
    await selected.getByRole('button', { name: 'Hide from guide' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(selected).toHaveCount(0);
    await expect
      .poll(async () =>
        Promise.all(
          ids.map(
            async (id) =>
              (await api<Channel>('GET', `/channels/${id}`)).stealth,
          ),
        ),
      )
      .toEqual([true, true]);
    const hiddenM3u = await fetch(`${SERVER_URL}/api/channels.m3u`).then(
      (response) => response.text(),
    );
    for (const id of ids)
      expect(hiddenM3u).not.toContain(`/stream/channels/${id}`);

    await page.reload();
    await selectChannels();
    await page.screenshot({
      path: testInfo.outputPath('after-hide.png'),
      fullPage: true,
    });
    await selected.getByRole('button', { name: 'Show in guide' }).click();
    await expect(selected).toHaveCount(0);
    await expect
      .poll(async () =>
        Promise.all(
          ids.map(
            async (id) =>
              (await api<Channel>('GET', `/channels/${id}`)).stealth,
          ),
        ),
      )
      .toEqual([false, false]);
    const shownM3u = await fetch(`${SERVER_URL}/api/channels.m3u`).then(
      (response) => response.text(),
    );
    for (const id of ids) expect(shownM3u).toContain(`/stream/channels/${id}`);
    const after = await Promise.all(
      ids.map((id) => api<Channel>('GET', `/channels/${id}`)),
    );
    for (let index = 0; index < before.length; index++) {
      expect(after[index]).toMatchObject(before[index] ?? {});
    }
    expect(requests).toEqual([
      {
        path: '/api/channels/bulk/stealth',
        method: 'POST',
        body: { ids, stealth: true },
      },
      {
        path: '/api/channels/bulk/stealth',
        method: 'POST',
        body: { ids, stealth: false },
      },
    ]);
    await health.settle();
    expect(health.problems).toEqual([]);
  } finally {
    for (const channel of original) {
      await api('POST', '/channels/bulk/stealth', {
        ids: [channel.id],
        stealth: channel.stealth,
      });
    }
  }
});
