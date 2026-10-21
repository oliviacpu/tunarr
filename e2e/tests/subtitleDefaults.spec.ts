import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type {
  GetApiSettingsFfmpegResponse as FfmpegSettings,
  GetChannelsByNumberV2Response as Channel,
} from '../../web/src/generated/types.gen.ts';
import { api } from '../fixture/api.ts';
import { SERVER_URL } from '../fixture/env.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

test.describe.configure({ mode: 'serial' });

const settingsPath = '/settings/ffmpeg';
const settingsUrl = `${SERVER_URL}/api${settingsPath}`;
const globals: FfmpegSettings['subtitlePreferences'] = [
  {
    languageCode: 'fra',
    filter: 'any',
    allowExternal: true,
    allowImageBased: false,
  },
  {
    languageCode: 'jpn',
    filter: 'forced',
    allowExternal: false,
    allowImageBased: true,
  },
];
const custom: NonNullable<Channel['subtitlePreferences']> = [
  {
    langugeCode: 'eng',
    priority: 0,
    filter: 'forced',
    allowExternal: false,
    allowImageBased: true,
  },
  {
    langugeCode: 'spa',
    priority: 1,
    filter: 'default',
    allowExternal: true,
    allowImageBased: false,
  },
];

let originalSettings: FfmpegSettings;
let originalChannel: Channel;

function channelId() {
  const id = readFixtureIds().channelIds[1];
  if (id === undefined) throw new Error('Fixture needs at least two channels');
  return id;
}

function channelBody(channel: Channel) {
  const {
    startTime: _startTime,
    onDemand: _onDemand,
    fallback: _fallback,
    programCount: _programCount,
    sessions: _sessions,
    ...editable
  } = channel;
  return {
    ...editable,
    subtitlePreferences: channel.subtitlePreferences ?? [],
  };
}

async function seedChannel(overrides: Partial<ReturnType<typeof channelBody>>) {
  await api('PUT', `/channels/${channelId()}`, {
    ...channelBody(originalChannel),
    subtitlesEnabled: true,
    streamMode: 'hls',
    subtitlePreferenceMode: 'custom',
    subtitlePreferences: custom,
    ...overrides,
  });
}

const globalPreference = (page: Page, priority: number) =>
  page.getByLabel(`Subtitle preference ${priority}`, { exact: true });
const globalForm = (page: Page) =>
  page
    .getByLabel('Add subtitle language', { exact: true })
    .locator('xpath=ancestor::form');
const saveButton = (scope: Locator | Page) =>
  scope.getByRole('button', { name: 'Save', exact: true });

async function openGlobal(page: Page) {
  await page.goto('/web/settings/captions-audio');
  await expect(
    page.getByRole('heading', {
      name: 'Global subtitle preferences',
      exact: true,
    }),
  ).toBeVisible();
}

async function openChannel(page: Page) {
  await page.goto(`/web/channels/${channelId()}/edit/streaming`);
  await expect(
    page.getByRole('combobox', { name: /^Subtitle preferences\b/ }),
  ).toBeVisible();
}

async function selectMode(page: Page, name: string) {
  await page.getByRole('combobox', { name: /^Subtitle preferences\b/ }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function save(page: Page, scope: Locator | Page, url: string) {
  const response = page.waitForResponse(
    (res) => res.url() === url && res.request().method() === 'PUT',
  );
  await saveButton(scope).click();
  expect((await response).ok()).toBe(true);
  await expect(saveButton(scope)).toBeDisabled();
}

async function addGlobal(page: Page, language: string) {
  await page
    .getByLabel('Add subtitle language', { exact: true })
    .fill(language);
  await page.getByRole('option', { name: language, exact: true }).click();
}

async function setFilter(page: Page, row: Locator, name: string) {
  await row.getByRole('combobox', { name: /^Filter\b/ }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test.beforeEach(async () => {
  originalSettings = await api<FfmpegSettings>('GET', settingsPath);
  originalChannel = await api<Channel>('GET', `/channels/${channelId()}`);
});

test.afterEach(async () => {
  await api('PUT', settingsPath, originalSettings);
  await api('PUT', `/channels/${channelId()}`, channelBody(originalChannel));
  expect(await api<FfmpegSettings>('GET', settingsPath)).toEqual(
    originalSettings,
  );
  const restored = await api<Channel>('GET', `/channels/${channelId()}`);
  expect(restored.subtitlePreferenceMode).toBe(
    originalChannel.subtitlePreferenceMode,
  );
  expect(restored.subtitlePreferences ?? []).toEqual(
    originalChannel.subtitlePreferences ?? [],
  );
  expect(restored.fillerCollections).toEqual(originalChannel.fillerCollections);
});

test('global subtitle order, filters and flags survive save, reload and clearing', async ({
  page,
}) => {
  await api('PUT', settingsPath, {
    ...originalSettings,
    subtitlePreferences: [],
  });
  await openGlobal(page);
  const form = globalForm(page);
  await expect(saveButton(form)).toBeDisabled();
  await addGlobal(page, 'English');
  await addGlobal(page, 'Spanish');
  await setFilter(page, globalPreference(page, 1), 'Forced');
  await globalPreference(page, 1)
    .getByRole('checkbox', { name: 'Allow external subtitles', exact: true })
    .uncheck();
  await setFilter(page, globalPreference(page, 2), 'Default');
  await globalPreference(page, 2)
    .getByRole('checkbox', { name: 'Allow image-based subtitles', exact: true })
    .uncheck();
  await page
    .getByRole('button', { name: 'Move subtitle preference 2 up', exact: true })
    .click();
  await expect(
    globalPreference(page, 1).getByRole('combobox', {
      name: 'Language',
      exact: true,
    }),
  ).toHaveValue('Spanish');
  await save(page, form, settingsUrl);
  const expected: FfmpegSettings['subtitlePreferences'] = [
    {
      languageCode: 'spa',
      filter: 'default',
      allowExternal: true,
      allowImageBased: false,
    },
    {
      languageCode: 'eng',
      filter: 'forced',
      allowExternal: false,
      allowImageBased: true,
    },
  ];
  expect(await api<FfmpegSettings>('GET', settingsPath)).toEqual({
    ...originalSettings,
    subtitlePreferences: expected,
  });
  await page.reload();
  await expect(
    globalPreference(page, 1).getByRole('combobox', {
      name: 'Language',
      exact: true,
    }),
  ).toHaveValue('Spanish');
  await expect(
    globalPreference(page, 2).getByRole('combobox', { name: /^Filter\b/ }),
  ).toHaveText('Forced');
  await expect(
    globalPreference(page, 1).getByRole('checkbox', {
      name: 'Allow image-based subtitles',
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    globalPreference(page, 2).getByRole('checkbox', {
      name: 'Allow external subtitles',
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole('button', { name: 'Clear subtitle preferences', exact: true })
    .click();
  await expect(saveButton(form)).toBeEnabled();
  await save(page, form, settingsUrl);
  await page.reload();
  await expect(
    page.getByText(
      'No global subtitle preferences. Channels that inherit keep their existing fallback.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await api<FfmpegSettings>('GET', settingsPath)).toEqual({
    ...originalSettings,
    subtitlePreferences: [],
  });
});

test('reset and failed saves preserve the saved global defaults and recoverable edits', async ({
  page,
}) => {
  await api('PUT', settingsPath, {
    ...originalSettings,
    subtitlePreferences: globals,
  });
  await openGlobal(page);
  const form = globalForm(page);
  await page
    .getByRole('button', { name: 'Remove subtitle preference 1', exact: true })
    .click();
  await expect(saveButton(form)).toBeEnabled();
  await form
    .getByRole('button', { name: 'Reset changes', exact: true })
    .click();
  await expect(
    globalPreference(page, 1).getByRole('combobox', {
      name: 'Language',
      exact: true,
    }),
  ).toHaveValue('French');
  await expect(saveButton(form)).toBeDisabled();
  await globalPreference(page, 1)
    .getByRole('checkbox', { name: 'Allow external subtitles', exact: true })
    .uncheck();
  await page.route(settingsUrl, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Acceptance test save failure' }),
      });
    } else await route.continue();
  });
  await saveButton(form).click();
  await expect(page.getByText(/Could not save settings/)).toBeVisible();
  await expect(saveButton(form)).toBeEnabled();
  await expect(
    globalPreference(page, 1).getByRole('checkbox', {
      name: 'Allow external subtitles',
      exact: true,
    }),
  ).not.toBeChecked();
  expect(
    (await api<FfmpegSettings>('GET', settingsPath)).subtitlePreferences,
  ).toEqual(globals);
  await page.unroute(settingsUrl);
  await save(page, form, settingsUrl);
  await page.reload();
  await expect(
    globalPreference(page, 1).getByRole('checkbox', {
      name: 'Allow external subtitles',
      exact: true,
    }),
  ).not.toBeChecked();
});

test('channel inheritance retains custom rows through mode changes, saves and reloads', async ({
  page,
}) => {
  await api('PUT', settingsPath, {
    ...originalSettings,
    subtitlePreferences: globals,
  });
  await seedChannel({});
  await openChannel(page);
  const english = page.getByRole('row').filter({ hasText: 'English' });
  await expect(english).toBeVisible();
  await selectMode(page, 'Use global defaults');
  await expect(
    page.getByText('Current global subtitle defaults', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('French — Any; External allowed; Image based excluded', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Japanese — Forced; External excluded; Image based allowed',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(page.getByLabel('Add Language Preference')).toHaveCount(0);
  await selectMode(page, 'Customize for this channel');
  await expect(english).toBeVisible();
  await selectMode(page, 'Use global defaults');
  await save(page, page, `${SERVER_URL}/api/channels/${channelId()}`);
  let saved = await api<Channel>('GET', `/channels/${channelId()}`);
  expect(saved.subtitlePreferenceMode).toBe('inherit');
  expect(saved.subtitlePreferences).toEqual(custom);
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: /^Subtitle preferences\b/ }),
  ).toHaveText('Use global defaults');
  await expect(
    page.getByText('Current global subtitle defaults', { exact: true }),
  ).toBeVisible();
  await selectMode(page, 'Customize for this channel');
  await expect(
    english.getByRole('cell', { name: 'Forced', exact: true }),
  ).toBeVisible();
  await expect(english.getByRole('checkbox').nth(0)).not.toBeChecked();
  await expect(english.getByRole('checkbox').nth(1)).toBeChecked();
  await save(page, page, `${SERVER_URL}/api/channels/${channelId()}`);
  await page.reload();
  await expect(english).toBeVisible();
  saved = await api<Channel>('GET', `/channels/${channelId()}`);
  expect(saved.subtitlePreferenceMode).toBe('custom');
  expect(saved.subtitlePreferences).toEqual(custom);
  expect(saved.fillerCollections).toEqual(originalChannel.fillerCollections);
  expect(saved.audioTracks).toEqual(originalChannel.audioTracks);
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const directory =
    process.env.TUNARR_S5C_CAPTURE_DIR ?? testInfo.outputPath('captures');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
  if (page.viewportSize()?.width !== 390) return;
  const isGlobal = name.startsWith('global-');
  const focus = isGlobal
    ? page.getByRole('heading', {
        name: 'Global subtitle preferences',
        exact: true,
      })
    : page.getByRole('combobox', { name: /^Subtitle preferences\b/ });
  await focus.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.evaluate(
    (offset) => window.scrollBy(0, -offset),
    isGlobal ? 32 : 160,
  );
  const focusedFile = path.join(directory, `${name}-focused.png`);
  await page.screenshot({ path: focusedFile, animations: 'disabled' });
  await testInfo.attach(`${name} focused`, {
    path: focusedFile,
    contentType: 'image/png',
  });
}

async function setTheme(page: Page, scheme: 'light' | 'dark') {
  const toggle = page.getByRole('button', {
    name: scheme === 'dark' ? 'Enable dark Mode' : 'Enable light Mode',
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  await expect(
    page.getByRole('button', {
      name: scheme === 'dark' ? 'Enable light Mode' : 'Enable dark Mode',
      exact: true,
    }),
  ).toBeVisible();
}

test('global defaults and channel subtitle states fit phone and desktop in both themes', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await api('PUT', settingsPath, {
    ...originalSettings,
    subtitlePreferences: globals,
  });
  const health = watchPageHealth(
    page,
    knownIssuesFor('/channels/$channelId/edit'),
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const scheme of ['light', 'dark'] as const) {
      await openGlobal(page);
      await setTheme(page, scheme);
      await health.settle();
      await capture(
        page,
        testInfo,
        `global-subtitle-defaults-${width}-${scheme}`,
      );
      for (const mode of [
        'inherit',
        'custom',
        'disabled',
        'direct-v2',
      ] as const) {
        await seedChannel({
          subtitlePreferenceMode: mode === 'custom' ? 'custom' : 'inherit',
          subtitlesEnabled: mode !== 'disabled',
          streamMode: mode === 'direct-v2' ? 'hls_direct_v2' : 'hls',
        });
        await openChannel(page);
        if (mode === 'disabled') {
          await expect(
            page.getByLabel('Enable subtitles', { exact: true }),
          ).not.toBeChecked();
          await expect(
            page.getByRole('combobox', {
              name: /^Subtitle preferences\b/,
            }),
          ).toBeEnabled();
          await expect(
            page.getByText(
              'Subtitles are disabled for this channel. These preferences are saved, but do not enable subtitles.',
              { exact: true },
            ),
          ).toBeVisible();
        } else if (mode === 'custom') {
          await expect(
            page.getByRole('row').filter({ hasText: 'English' }),
          ).toBeVisible();
        } else {
          await expect(
            page.getByText('Current global subtitle defaults', { exact: true }),
          ).toBeVisible();
        }
        if (mode === 'direct-v2') {
          await expect(
            page.getByLabel('Audio tracks', { exact: true }),
          ).toBeDisabled();
          await expect(
            page.getByText(/HLS Direct v2 supports text subtitles only\./),
          ).toBeVisible();
        }
        await health.settle();
        await capture(
          page,
          testInfo,
          `channel-subtitles-${mode}-${width}-${scheme}`,
        );
      }
    }
  }
  expect(health.problems).toEqual([]);
});
