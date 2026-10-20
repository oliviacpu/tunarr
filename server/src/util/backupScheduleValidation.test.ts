import { BackupSettingsSchema } from '@tunarr/types/schemas';
import { describe, expect, test } from 'vitest';
import { backupScheduleProblem } from './backupScheduleValidation.ts';

function settings(cron: string) {
  return BackupSettingsSchema.parse({
    configurations: [
      { enabled: true, schedule: { type: 'cron', cron }, outputs: [] },
    ],
  });
}

describe('backup cron validation', () => {
  test.each(['not cron', '70 4 * * *', '0 0 31 2 *', '', '* * * * * * *'])(
    'rejects invalid expression %j',
    (cron) => {
      expect(backupScheduleProblem(settings(cron))).toContain(
        'Backup 1 has an invalid cron expression',
      );
    },
  );
  test.each(['0 4 * * *', '0 0 4 * * *', '*/15 4-8 * JAN MON-FRI'])(
    'accepts scheduler expression %j',
    (cron) => {
      expect(backupScheduleProblem(settings(cron))).toBeUndefined();
    },
  );
  test('interval schedules remain unchanged', () => {
    expect(
      backupScheduleProblem(
        BackupSettingsSchema.parse({
          configurations: [
            {
              enabled: false,
              schedule: {
                type: 'every',
                increment: 1,
                unit: 'day',
                offsetMs: 0,
              },
              outputs: [],
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });
});
