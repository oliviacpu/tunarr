import { expect, test } from '@playwright/test';
import type { GetChannelsByNumberV2Response as Channel } from '../../web/src/generated/types.gen.ts';
import { api } from '../fixture/api.ts';
import { SERVER_URL } from '../fixture/env.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

test('one confirmation deletes selected channels through one batch', async ({
  page,
}, testInfo) => {
  const originalIds = readFixtureIds().channelIds;
  const sourceId = originalIds[0];
  if (sourceId === undefined) throw new Error('Fixture channel missing');
  const created: Channel[] = [];
  const requests: { method: string; path: string; body: unknown }[] = [];
  const health = watchPageHealth(page, knownIssuesFor('/channels'));

  try {
    for (const suffix of ['A', 'B']) {
      const copy = await api<Channel>('POST', '/channels', {
        type: 'copy',
        channelId: sourceId,
      });
      created.push(copy);
      const {
        fallback: _fallback,
        programCount: _programCount,
        sessions: _sessions,
        ...editable
      } = copy;
      const renamed = await api<Channel>('PUT', `/channels/${copy.id}`, {
        ...editable,
        name: `E2E Bulk Delete ${suffix}`,
      });
      Object.assign(copy, renamed);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/web/channels');
    for (const channel of created) {
      const row = page.getByRole('row').filter({
        has: page.getByRole('cell', { name: channel.name, exact: true }),
      });
      await row.getByRole('checkbox').check();
    }
    page.on('request', (request) => {
      if (request.method() === 'POST' || request.method() === 'DELETE') {
        requests.push({
          method: request.method(),
          path: new URL(request.url()).pathname,
          body: request.postDataJSON(),
        });
      }
    });
    await page
      .getByRole('group', { name: 'Selected rows' })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Delete 2 channels?');
    await expect(dialog.getByRole('listitem')).toHaveText(
      created.map((channel) => channel.name),
    );
    await page.screenshot({
      path: testInfo.outputPath('before-delete.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
    for (const channel of created) {
      await expect(
        page.getByRole('cell', { name: channel.name, exact: true }),
      ).toHaveCount(0);
      expect(
        (await fetch(`${SERVER_URL}/api/channels/${channel.id}`)).status,
      ).toBe(404);
    }
    await page.reload();
    const retained = await api<Channel[]>('GET', '/channels');
    expect(retained.map((channel) => channel.id).sort()).toEqual(
      [...originalIds].sort(),
    );
    const playlist = await fetch(`${SERVER_URL}/api/channels.m3u`).then(
      (response) => response.text(),
    );
    for (const channel of created)
      expect(playlist).not.toContain(`/stream/channels/${channel.id}`);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/channels/bulk/delete',
        body: { ids: created.map((channel) => channel.id) },
      },
    ]);
    await page.screenshot({
      path: testInfo.outputPath('after-delete.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await health.settle();
    expect(health.problems).toEqual([]);
  } finally {
    if (created.length > 0) {
      await api('POST', '/channels/bulk/delete', {
        ids: created.map((channel) => channel.id),
      });
    }
  }
});
