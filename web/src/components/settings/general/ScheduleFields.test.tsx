import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import type { Schedule } from '@tunarr/types/schemas';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { describe, expect, test } from 'vitest';
import type { GeneralSettingsFormData } from './GeneralSettingsForm.tsx';
import { ScheduleFields } from './ScheduleFields.tsx';

const ThreeAm = 3 * 60 * 60 * 1000;

const dailyAtThree: Schedule = {
  type: 'every',
  increment: 1,
  unit: 'day',
  offsetMs: ThreeAm,
};

// The General settings form with one backup on the given schedule. The
// schedule the form holds is printed under the fields
function Harness({ schedule }: { schedule: Schedule }) {
  const form = useForm<GeneralSettingsFormData>({
    defaultValues: {
      backendUri: '',
      logLevel: 'info',
      logRollOnSchedule: false,
      backup: {
        configurations: [
          {
            enabled: true,
            outputs: [
              {
                type: 'file',
                outputPath: '',
                archiveFormat: 'tar',
                maxBackups: 3,
              },
            ],
            schedule,
          },
        ],
      },
      server: { port: 8000, searchSettings: { snapshotIntervalHours: 4 } },
      logging: {
        logLevel: 'info',
        logsDirectory: '/config/logs',
        useEnvVarLevel: false,
        logRollConfig: {
          enabled: true,
          rolledFileLimit: 3,
          maxFileSizeBytes: 0,
          schedule: { type: 'every', unit: 'day', increment: 0, offsetMs: 0 },
        },
      },
    },
    mode: 'onTouched',
  });
  const held = useWatch({
    control: form.control,
    name: 'backup.configurations.0.schedule',
  });
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <FormProvider {...form}>
        <ScheduleFields
          name="backup.configurations.0.schedule"
          intervalLabel="Backup interval"
          id="backup-schedule"
        />
        <output data-testid="held">{JSON.stringify(held)}</output>
      </FormProvider>
    </LocalizationProvider>
  );
}

function renderFields(schedule: Schedule = dailyAtThree) {
  const rendered = renderWithProviders(<Harness schedule={schedule} />);
  const held = (): unknown =>
    JSON.parse(screen.getByTestId('held').textContent ?? 'null');
  const interval = () => screen.getByLabelText('Backup interval');
  const unit = () => screen.getByRole('combobox', { name: 'Unit' });
  const timeOfDay = () => screen.queryByRole('group', { name: 'Time of day' });
  return { ...rendered, held, interval, unit, timeOfDay };
}

describe('ScheduleFields', () => {
  test('the interval, unit and time of day each have a label', () => {
    const { interval, unit, timeOfDay } = renderFields();

    expect(interval()).toHaveValue('1');
    expect(unit()).toHaveTextContent('Day');
    const time = timeOfDay();
    expect(time).not.toBeNull();
    expect(
      within(time ?? document.body).getByRole('spinbutton', { name: 'Hours' }),
    ).toHaveTextContent('03');
  });

  test('clearing the interval keeps it on screen and says why', async () => {
    const { user, interval } = renderFields();

    await user.clear(interval());
    await user.tab();

    await waitFor(() =>
      expect(interval()).toHaveAccessibleDescription(
        'Backup interval must be at least 1.',
      ),
    );
    expect(interval()).toBeInvalid();

    // 0 is not an interval either, and does not hide the field
    await user.type(interval(), '0');
    expect(interval()).toBeInTheDocument();
    expect(interval()).toHaveAccessibleDescription(
      'Backup interval must be at least 1.',
    );
  });

  test('the unit names follow the interval, and hours have no time of day', async () => {
    const { user, interval, unit, timeOfDay, held } = renderFields();

    await user.clear(interval());
    await user.type(interval(), '6');
    await user.click(unit());
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Hours', 'Days']);
    await user.click(within(listbox).getByRole('option', { name: 'Hours' }));

    await waitFor(() => expect(timeOfDay()).toBeNull());
    expect(held()).toEqual({
      type: 'every',
      increment: 6,
      unit: 'hour',
      offsetMs: ThreeAm,
    });
  });

  test('the time of day is kept as milliseconds after midnight', async () => {
    const { user, timeOfDay, held } = renderFields();
    const time = timeOfDay();
    if (time === null) {
      throw new Error('A daily schedule shows its time of day');
    }

    await user.click(within(time).getByRole('spinbutton', { name: 'Hours' }));
    await user.keyboard('{ArrowUp}');

    await waitFor(() =>
      expect(held()).toMatchObject({ offsetMs: 4 * 60 * 60 * 1000 }),
    );
  });

  test('a unit only settings.json can set is shown as it is', () => {
    const { unit } = renderFields({ ...dailyAtThree, unit: 'week' });

    expect(unit()).toHaveTextContent('Week');
  });

  test('a cron schedule is shown as text', () => {
    renderFields({ type: 'cron', cron: '0 3 * * *' });

    expect(screen.getByText(/Runs on the cron schedule/)).toHaveTextContent(
      'Runs on the cron schedule 0 3 * * *, set in settings.json.',
    );
    expect(screen.queryByLabelText('Backup interval')).not.toBeInTheDocument();
  });
});
