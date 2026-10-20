import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type {
  GetApiFfmpegSettingsResponse,
  GetApiSystemSettingsResponse,
} from '../../web/src/generated/types.gen.ts';
import { DATA_DIR, SERVER_URL } from '../fixture/env.ts';
import { savedSettings } from './settingsForm.ts';

test.describe.configure({ mode: 'serial' });

const ffmpegUrl = `${SERVER_URL}/api/ffmpeg-settings`;
const systemUrl = `${SERVER_URL}/api/system/settings`;

async function saveForm(page: Page, field: Locator, url: string) {
  const form = field.locator('xpath=ancestor::form');
  const response = page.waitForResponse(
    (res) => res.url() === url && res.request().method() === 'PUT',
  );
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(
    form.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
}

for (const { key, label, option } of [
  { key: 'scalingAlgorithm', label: 'Scaling algorithm', option: 'Lanczos' },
  { key: 'deinterlaceFilter', label: 'Deinterlace filter', option: 'bwdif=1' },
] as const) {
  test(`${label} saves and reloads without changing other playback settings`, async ({
    page,
  }) => {
    const before = await savedSettings<GetApiFfmpegSettingsResponse>(
      page,
      ffmpegUrl,
    );
    try {
      await page.goto('/web/settings/playback');
      const field = page.getByRole('combobox', { name: label });
      await field.click();
      await page.getByRole('option', { name: option, exact: true }).click();
      await saveForm(page, field, ffmpegUrl);
      await page.reload();
      await expect(field).toHaveText(option);
      expect(await savedSettings(page, ffmpegUrl)).toEqual({
        ...before,
        [key]: key === 'scalingAlgorithm' ? 'lanczos' : 'bwdif=1',
      });
    } finally {
      expect((await page.request.put(ffmpegUrl, { data: before })).ok()).toBe(
        true,
      );
    }
  });
}

test('rolled-file retention saves and reloads without changing other system settings', async ({
  page,
}) => {
  const before = await savedSettings<GetApiSystemSettingsResponse>(
    page,
    systemUrl,
  );
  try {
    await page.goto('/web/settings/general');
    const field = page.getByLabel('Rolled files to keep', { exact: true });
    await field.fill('7');
    await saveForm(page, field, systemUrl);
    await page.reload();
    await expect(field).toHaveValue('7');
    expect(await savedSettings(page, systemUrl)).toEqual({
      ...before,
      logging: {
        ...before.logging,
        logRollConfig: { ...before.logging.logRollConfig, rolledFileLimit: 7 },
      },
    });
  } finally {
    expect((await page.request.put(systemUrl, { data: before })).ok()).toBe(
      true,
    );
  }
});

for (const setting of ['tempDir', 'cron', 'enabled'] as const) {
  test(`backup ${setting} saves and reloads without changing other configuration`, async ({
    page,
  }) => {
    const original = await savedSettings<GetApiSystemSettingsResponse>(
      page,
      systemUrl,
    );
    const configuration = {
      enabled: false,
      schedule: { type: 'cron' as const, cron: '0 4 * * *' },
      outputs: [
        {
          type: 'file' as const,
          outputPath: '',
          archiveFormat: 'tar' as const,
          maxBackups: 3,
        },
      ],
    };
    const backup = {
      configurations:
        setting === 'enabled'
          ? [configuration, configuration]
          : [configuration],
    };
    expect((await page.request.put(systemUrl, { data: { backup } })).ok()).toBe(
      true,
    );
    const before = await savedSettings<GetApiSystemSettingsResponse>(
      page,
      systemUrl,
    );
    try {
      await page.goto('/web/settings/general');
      const field =
        setting === 'enabled'
          ? page
              .getByRole('group', { name: 'Backup 2', exact: true })
              .getByRole('checkbox', {
                name: 'Enable this backup schedule',
                exact: true,
              })
          : page.getByRole('textbox', {
              name:
                setting === 'cron'
                  ? 'Cron expression'
                  : 'Temporary backup folder',
              exact: true,
            });
      if (setting === 'enabled') await field.check();
      else await field.fill(setting === 'cron' ? '0 5 * * *' : DATA_DIR);
      await saveForm(page, field, systemUrl);
      await page.reload();
      if (setting === 'enabled') await expect(field).toBeChecked();
      else
        await expect(field).toHaveValue(
          setting === 'cron' ? '0 5 * * *' : DATA_DIR,
        );
      const expected =
        setting === 'enabled'
          ? { ...configuration, enabled: true }
          : setting === 'cron'
            ? {
                ...configuration,
                schedule: { type: 'cron', cron: '0 5 * * *' },
              }
            : {
                ...configuration,
                outputs: [{ ...configuration.outputs[0], tempDir: DATA_DIR }],
              };
      expect(await savedSettings(page, systemUrl)).toEqual({
        ...before,
        backup: {
          configurations:
            setting === 'enabled' ? [configuration, expected] : [expected],
        },
      });
    } finally {
      expect((await page.request.put(systemUrl, { data: original })).ok()).toBe(
        true,
      );
    }
  });
}

for (const { key, label, value } of [
  {
    key: 'snapshotIntervalHours',
    label: 'Search snapshot interval (hours)',
    value: 8,
  },
  {
    key: 'maxIndexingMemory',
    label: 'Indexing memory limit (bytes)',
    value: 536870912,
  },
] as const) {
  test(`${label} saves and reloads without changing the server port or other settings`, async ({
    page,
  }) => {
    const before = await savedSettings<GetApiSystemSettingsResponse>(
      page,
      systemUrl,
    );
    try {
      await page.goto('/web/settings/library');
      await expect(
        page.getByText('Restart required', { exact: true }),
      ).toBeVisible();
      const field = page.getByLabel(label, { exact: true });
      await expect(
        field
          .locator('xpath=ancestor::form')
          .getByRole('button', { name: 'Save', exact: true }),
      ).toBeDisabled();
      await field.fill(String(value));
      await saveForm(page, field, systemUrl);
      await page.reload();
      await expect(field).toHaveValue(String(value));
      expect(await savedSettings(page, systemUrl)).toEqual({
        ...before,
        server: {
          ...before.server,
          searchSettings: { ...before.server.searchSettings, [key]: value },
        },
      });
    } finally {
      expect((await page.request.put(systemUrl, { data: before })).ok()).toBe(
        true,
      );
    }
  });
}

test('clearing the indexing memory limit restores the automatic limit', async ({
  page,
}) => {
  const original = await savedSettings<GetApiSystemSettingsResponse>(
    page,
    systemUrl,
  );
  const server = {
    ...original.server,
    searchSettings: {
      ...original.server.searchSettings,
      maxIndexingMemory: 536870912,
    },
  };
  expect((await page.request.put(systemUrl, { data: { server } })).ok()).toBe(
    true,
  );
  try {
    await page.goto('/web/settings/library');
    const field = page.getByLabel('Indexing memory limit (bytes)', {
      exact: true,
    });
    await field.clear();
    await saveForm(page, field, systemUrl);
    await page.reload();
    await expect(field).toBeEmpty();
    await expect(
      field
        .locator('xpath=ancestor::form')
        .getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled();
    const saved = await savedSettings<GetApiSystemSettingsResponse>(
      page,
      systemUrl,
    );
    expect(saved).toEqual(original);
  } finally {
    expect((await page.request.put(systemUrl, { data: original })).ok()).toBe(
      true,
    );
  }
});

test('missing controls fit phone and desktop layouts in both themes', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const original = await savedSettings<GetApiSystemSettingsResponse>(
    page,
    systemUrl,
  );
  const backup = {
    configurations: [
      {
        enabled: false,
        schedule: { type: 'cron', cron: '0 4 * * *' },
        outputs: [
          {
            type: 'file',
            outputPath: '',
            archiveFormat: 'tar',
            maxBackups: 3,
            tempDir: DATA_DIR,
          },
        ],
      },
    ],
  };
  expect((await page.request.put(systemUrl, { data: { backup } })).ok()).toBe(
    true,
  );
  try {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const tab of ['general', 'playback', 'library']) {
          await page.goto(`/web/settings/${tab}`);
          await expect(
            page.getByRole('heading', {
              level: 2,
              name:
                tab === 'general'
                  ? 'General'
                  : tab === 'playback'
                    ? 'Playback'
                    : 'Library',
              exact: true,
            }),
          ).toBeVisible();
          await page
            .getByRole('tab', {
              name:
                tab === 'general'
                  ? 'General'
                  : tab === 'playback'
                    ? 'Playback'
                    : 'Library',
              exact: true,
            })
            .scrollIntoViewIfNeeded();
          await expect(
            page.getByRole('button', { name: 'Save', exact: true }).first(),
          ).toBeVisible();
          for (const button of await page
            .getByRole('button', { name: 'Save', exact: true })
            .all())
            await expect(button).toBeDisabled();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true);
          const path = testInfo.outputPath(
            `${tab}-${width}-${colorScheme}.png`,
          );
          await page.screenshot({ path, fullPage: true });
          await testInfo.attach(`${tab} ${width} ${colorScheme}`, {
            path,
            contentType: 'image/png',
          });
        }
      }
    }
  } finally {
    expect((await page.request.put(systemUrl, { data: original })).ok()).toBe(
      true,
    );
  }
});
