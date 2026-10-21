import { renderWithProviders, screen } from '@/test/utils';
import {
  SettingsApplicationTiming,
  type SettingsApplicationKey,
  FfmpegSettingsApplicationGroups,
  FeatureFlagsApplicationGroups,
  FeatureFlagsSchema,
  defaultFfmpegSettings,
} from '@tunarr/types';
import docs from '../../../../docs/configure/settings/applies-when.md?raw';
import { describe, expect, test } from 'vitest';
import { i18n } from '@lingui/core';
import { act } from '@/test/utils';
import { SettingsApplicationMessages } from './settingsApplicationMessages.ts';
import { AppliesWhen } from './AppliesWhen.tsx';

const labels = {
  live: 'Live',
  'next-session': 'Next session',
  'next-program': 'Next program',
  reload: 'Reload required',
  restart: 'Restart required',
};

describe('settings application timing', () => {
  test('the reviewed runtime mapping stays explicit', () => {
    expect(SettingsApplicationTiming).toMatchSnapshot();
    expect(FfmpegSettingsApplicationGroups).toMatchSnapshot();
    expect(FeatureFlagsApplicationGroups).toMatchSnapshot();
  });
  test('every active FFmpeg field and feature flag is mapped', () => {
    expect(Object.keys(FfmpegSettingsApplicationGroups).sort()).toEqual(
      Object.keys(defaultFfmpegSettings)
        .filter(
          (key) => key !== 'configVersion' && key !== 'subtitlePreferences',
        )
        .sort(),
    );
    expect(Object.keys(FeatureFlagsApplicationGroups).sort()).toEqual(
      Object.keys(FeatureFlagsSchema.shape).sort(),
    );
  });
  test('documentation describes exactly the shared mapping', () => {
    const rows = docs
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('| ') &&
          !line.startsWith('| Setting') &&
          !line.startsWith('| ---'),
      );
    expect(rows).toEqual(
      Object.values(SettingsApplicationTiming).map(
        (timing) =>
          `| ${timing.title} | ${labels[timing.when]} | ${timing.description} |`,
      ),
    );
  });
  test.each([
    ['logging', 'Live'],
    ['captionsEnabled', 'Next session'],
    ['videoFilters', 'Next program'],
    ['hlsDirectOutput', 'Next program'],
    ['backendAddress', 'Reload required'],
    ['serverPort', 'Restart required'],
  ] as const)(
    '%s exposes the timing and explanation on keyboard focus',
    async (setting, label) => {
      const { user } = renderWithProviders(<AppliesWhen setting={setting} />);
      const chip = screen.getByLabelText(
        `${SettingsApplicationTiming[setting].title}: ${label}`,
      );
      expect(chip).toHaveTextContent(label);
      await user.tab();
      expect(chip).toHaveFocus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        SettingsApplicationTiming[setting].description,
      );
    },
  );
});

test('extractable timing messages match the shared source registry', () => {
  for (const setting of Object.keys(
    SettingsApplicationTiming,
  ) as SettingsApplicationKey[]) {
    expect(SettingsApplicationMessages[setting].title.message).toBe(
      SettingsApplicationTiming[setting].title,
    );
    expect(SettingsApplicationMessages[setting].description.message).toBe(
      SettingsApplicationTiming[setting].description,
    );
  }
});

for (const [locale, title, description] of [
  ['es', 'Preferencias del navegador', 'Los cambios se aplican de inmediato.'],
  ['zh-CN', '浏览器偏好设置', '更改会立即应用。'],
] as const) {
  test(`timing title and explanation use the active ${locale} catalog`, async () => {
    const messages = SettingsApplicationMessages.browserPreferences;
    try {
      act(() =>
        i18n.loadAndActivate({
          locale,
          messages: {
            [messages.title.id]: title,
            [messages.description.id]: description,
          },
        }),
      );
      const { user } = renderWithProviders(
        <AppliesWhen setting="browserPreferences" />,
      );
      const chip = screen.getByRole('button', { name: `${title}: Live` });
      await user.tab();
      expect(chip).toHaveFocus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(description);
    } finally {
      act(() => i18n.loadAndActivate({ locale: 'en', messages: {} }));
    }
  });
}
