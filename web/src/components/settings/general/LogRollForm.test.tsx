import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import type { Schedule } from '@tunarr/types/schemas';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { describe, expect, test } from 'vitest';
import type { GeneralSettingsFormData } from './GeneralSettingsForm.tsx';
import { LogRollForm } from './LogRollForm.tsx';

const hourly: Schedule = {
  type: 'every',
  unit: 'hour',
  increment: 1,
  offsetMs: 0,
};

// The form the General page fills in when no schedule is saved
const noSchedule: Schedule = {
  type: 'every',
  unit: 'day',
  increment: 0,
  offsetMs: 0,
};

// The schedule the form holds is printed under the fields
function Harness({
  onSchedule = true,
  schedule = hourly,
}: {
  onSchedule?: boolean;
  schedule?: Schedule;
}) {
  const form = useForm<GeneralSettingsFormData>({
    defaultValues: {
      backendUri: '',
      logLevel: 'info',
      logRollOnSchedule: onSchedule,
      backup: { configurations: [] },
      server: { port: 8000, searchSettings: { snapshotIntervalHours: 4 } },
      logging: {
        logLevel: 'info',
        logsDirectory: '/config/logs',
        useEnvVarLevel: false,
        logRollConfig: {
          enabled: true,
          rolledFileLimit: 3,
          maxFileSizeBytes: 0,
          schedule,
        },
      },
    },
    mode: 'onChange',
  });
  const held = useWatch({
    control: form.control,
    name: 'logging.logRollConfig.schedule',
  });
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <FormProvider {...form}>
        <LogRollForm />
        <output data-testid="held">{JSON.stringify(held)}</output>
      </FormProvider>
    </LocalizationProvider>
  );
}

const heldSchedule = (): unknown =>
  JSON.parse(screen.getByTestId('held').textContent ?? 'null');
const rollOnSchedule = () =>
  screen.getByRole('checkbox', { name: 'Roll on schedule' });

describe('LogRollForm', () => {
  test('the schedule increment names itself in its validation message', async () => {
    const { user } = renderWithProviders(<Harness />);
    const increment = screen.getByDisplayValue('1');

    // Any other value that is not a positive number hides the field, since
    // only a positive increment shows it
    await user.tripleClick(increment);
    await user.paste('Infinity');

    await waitFor(() =>
      expect(increment).toHaveAccessibleDescription(
        'Roll interval should be numeric.',
      ),
    );
    expect(screen.queryByText(/Max Backups/)).not.toBeInTheDocument();
  });

  test('clearing the roll interval keeps it on screen and says why', async () => {
    const { user } = renderWithProviders(<Harness />);
    const interval = () => screen.getByLabelText('Roll interval');

    await user.clear(interval());
    await user.tab();

    await waitFor(() =>
      expect(interval()).toHaveAccessibleDescription(
        'Roll interval must be at least 1.',
      ),
    );
    expect(rollOnSchedule()).toBeChecked();
  });

  test('ticking Roll on schedule with no schedule starts daily at midnight', async () => {
    const { user } = renderWithProviders(
      <Harness onSchedule={false} schedule={noSchedule} />,
    );
    expect(screen.queryByLabelText('Roll interval')).not.toBeInTheDocument();

    await user.click(rollOnSchedule());

    expect(screen.getByLabelText('Roll interval')).toHaveValue('1');
    expect(heldSchedule()).toEqual({
      type: 'every',
      unit: 'day',
      increment: 1,
      offsetMs: 0,
    });
  });

  test('unticking Roll on schedule hides the schedule, and ticking it again brings it back', async () => {
    const { user } = renderWithProviders(
      <Harness schedule={{ ...hourly, increment: 6 }} />,
    );

    await user.click(rollOnSchedule());
    expect(screen.queryByLabelText('Roll interval')).not.toBeInTheDocument();

    await user.click(rollOnSchedule());
    expect(screen.getByLabelText('Roll interval')).toHaveValue('6');
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveTextContent(
      'Hours',
    );
  });
});
