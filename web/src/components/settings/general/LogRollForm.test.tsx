import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, test } from 'vitest';
import type { GeneralSettingsFormData } from './GeneralSettingsForm.tsx';
import { LogRollForm } from './LogRollForm.tsx';

function Harness() {
  const form = useForm<GeneralSettingsFormData>({
    defaultValues: {
      backendUri: '',
      logLevel: 'info',
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
          // Hourly, so there is no time picker, which needs a date adapter
          schedule: { type: 'every', unit: 'hour', increment: 1, offsetMs: 0 },
        },
      },
    },
    mode: 'onChange',
  });
  return (
    <FormProvider {...form}>
      <LogRollForm />
    </FormProvider>
  );
}

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
});
