import type { BackupSettings } from '@tunarr/types/schemas';
import parser from 'cron-parser';

export function backupScheduleProblem(
  settings: BackupSettings,
): string | undefined {
  for (const [index, configuration] of settings.configurations.entries()) {
    if (configuration.schedule.type !== 'cron') continue;
    try {
      if (configuration.schedule.cron.trim().length === 0)
        throw new Error('Empty cron expression');
      parser.parseExpression(configuration.schedule.cron).next();
    } catch {
      return `Backup ${index + 1} has an invalid cron expression. Enter a valid cron expression before saving.`;
    }
  }
  return undefined;
}
