import { renderWithProviders, screen } from '@/test/utils';
import {
  SettingsApplicationTiming,
  FfmpegSettingsApplicationGroups,
  FeatureFlagsApplicationGroups,
  FeatureFlagsSchema,
  defaultFfmpegSettings,
} from '@tunarr/types';
import docs from '../../../../docs/configure/settings/applies-when.md?raw';
import { describe, expect, test } from 'vitest';
import { AppliesWhen } from './AppliesWhen.tsx';

const labels = {
  live: 'Live',
  'next-session': 'Next session',
  'next-program': 'Next program',
  restart: 'Restart required',
};

describe('settings application timing', () => {
  test('the reviewed runtime mapping stays explicit', () => {
    expect(SettingsApplicationTiming).toMatchSnapshot();
    expect(FfmpegSettingsApplicationGroups).toMatchSnapshot();
    expect(FeatureFlagsApplicationGroups).toMatchSnapshot();
  });
  test('every editable FFmpeg field and feature flag is mapped', () => {
    expect(Object.keys(FfmpegSettingsApplicationGroups).sort()).toEqual(
      Object.keys(defaultFfmpegSettings)
        .filter((key) => key !== 'configVersion')
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
