import {
  act,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/test/utils';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { SaveableChannel, TranscodeConfig } from '@tunarr/types';
import type { ReactNode } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TranscodeConfigErrorOptions } from '../settings/ffmpeg/TranscodeConfigErrorOptions.tsx';
import ChannelTranscodingConfig from './ChannelTranscodingConfig.tsx';
import ChannelWatermarkConfig from './ChannelWatermarkConfig.tsx';

vi.mock('../../store/index.ts', () => ({
  default: Object.assign(() => ({ icon: { path: '' } }), {
    getState: () => ({ settings: { backendUri: '' } }),
  }),
}));
vi.mock('../../store/settings/selectors.ts', () => ({
  useSettings: () => ({ backendUri: '' }),
}));
vi.mock('../../hooks/settingsHooks.ts', () => ({
  useTranscodeConfigs: () => ({
    data: [
      {
        id: 'preset',
        name: 'Preset',
        resolution: { widthPx: 1920, heightPx: 1080 },
      },
    ],
  }),
}));
vi.mock('../base/RouterLink.tsx', () => ({
  RouterLink: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));
vi.mock('./ChannelAudioTracksField.tsx', () => ({
  ChannelAudioTracksField: () => null,
}));
vi.mock('./ChannelCaptionsField.tsx', () => ({
  ChannelCaptionsField: () => null,
}));
vi.mock('./ChannelSubtitlePreferencesField.tsx', () => ({
  ChannelSubtitlePreferencesField: () => null,
}));
vi.mock('../settings/ImageUploadInput.tsx', () => ({
  ImageUploadInput: () => null,
}));

type FormValues = SaveableChannel &
  Pick<TranscodeConfig, 'errorScreen' | 'errorScreenAudio'>;
type OptionField =
  | 'streamMode'
  | 'watermark.position'
  | 'errorScreen'
  | 'errorScreenAudio';

function Harness({
  field,
  children,
}: {
  field: OptionField;
  children: ReactNode;
}) {
  const form = useForm<FormValues>({
    defaultValues: {
      streamMode: 'hls',
      transcodeConfigId: 'preset',
      subtitlesEnabled: false,
      watermark: {
        enabled: true,
        position: 'bottom-right',
        width: 10,
        horizontalMargin: 0,
        verticalMargin: 0,
        duration: 0,
        opacity: 100,
        fixedSize: false,
        url: '',
        fadeConfig: [],
      },
      errorScreen: 'pic',
      errorScreenAudio: 'silent',
    },
  });
  const value = useWatch({ control: form.control, name: field });
  return (
    <FormProvider {...form}>
      {children}
      <output data-testid="value">{value}</output>
    </FormProvider>
  );
}

const fields = [
  {
    field: 'streamMode',
    component: <ChannelTranscodingConfig />,
    index: 0,
    options: [
      ['hls', msg`HLS (recommended)`],
      ['hls_slower', msg`HLS Alt`],
      ['hls_direct_v2', msg`HLS Direct v2`],
      ['hls_direct', msg`HLS Direct`],
      ['mpegts', msg`MPEG-TS (legacy)`],
    ],
  },
  {
    field: 'watermark.position',
    component: <ChannelWatermarkConfig />,
    index: 0,
    options: [
      ['bottom-right', msg`Bottom Right`],
      ['bottom-left', msg`Bottom Left`],
      ['top-right', msg`Top Right`],
      ['top-left', msg`Top Left`],
    ],
  },
  {
    field: 'errorScreen',
    component: <TranscodeConfigErrorOptions />,
    index: 0,
    options: [
      ['pic', msg`Default Generic Error Image`],
      ['blank', msg`Blank Screen`],
      ['static', msg`Static`],
      ['testsrc', msg`Test Pattern (color bars + timer)`],
      ['text', msg`Detailed error (requires ffmpeg with drawtext)`],
      ['kill', msg`Stop stream, show errors in logs`],
    ],
  },
  {
    field: 'errorScreenAudio',
    component: <TranscodeConfigErrorOptions />,
    index: 1,
    options: [
      ['whitenoise', msg`White Noise`],
      ['sine', msg`Beep`],
      ['silent', msg`No Audio`],
    ],
  },
] as const;

describe('localized settings options', () => {
  afterEach(() => {
    act(() => i18n.loadAndActivate({ locale: 'en', messages: {} }));
  });

  test.each(fields)(
    '$field translates labels while preserving every exact saved value',
    async ({ field, component, index, options }) => {
      i18n.loadAndActivate({
        locale: 'es',
        messages: Object.fromEntries(
          options.map(([, label], i) => [label.id, `Opción ${i + 1}`]),
        ),
      });
      const { user } = renderWithProviders(
        <Harness field={field}>{component}</Harness>,
      );
      for (const [optionIndex, [value]] of options.entries()) {
        const select = screen.getAllByRole('combobox')[index];
        if (select === undefined)
          throw new Error(`Missing select for ${field}`);
        await user.click(select);
        const displayed = within(
          await screen.findByRole('listbox'),
        ).getAllByRole('option');
        expect(
          displayed.map((option) => [
            option.getAttribute('data-value'),
            option.textContent,
          ]),
        ).toEqual(
          options.map(([wireValue], i) => [wireValue, `Opción ${i + 1}`]),
        );
        const option = displayed[optionIndex];
        if (option === undefined)
          throw new Error(`Missing option for ${value}`);
        await user.click(option);
        await waitFor(() =>
          expect(screen.getByTestId('value')).toHaveTextContent(value),
        );
      }
    },
  );
});
