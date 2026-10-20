// The action vocabulary: the only labels for these actions, and the toast that
// confirms each one. Use one verb through the whole flow (Save -> Saved,
// Delete -> Deleted). Do not write "Update", "Submit", "Reset Options" or
// "Settings Saved!" by hand; add a row here if an action is missing.
// Failures: "Could not save settings" is for the settings pages only; every
// other save uses the generic "Could not save".
//
// These are functions, not constants, so the message is looked up in the
// active locale when it renders rather than when the module loads.
import { isNonEmptyString } from '@/helpers/util';
import { t } from '@lingui/core/macro';

export const actions = {
  save: () => t`Save`,
  cancel: () => t`Cancel`,
  delete: () => t`Delete`,
  resetChanges: () => t`Reset changes`,
  restoreDefaults: () => t`Restore defaults`,
  add: () => t`Add`,
  create: () => t`Create`,
  remove: () => t`Remove`,
  close: () => t`Close`,
} as const;

export const toasts = {
  saved: () => t`Saved`,
  deleted: () => t`Deleted`,
  changesReset: () => t`Changes reset`,
  defaultsRestored: () => t`Defaults restored`,
  couldNotSave: () => t`Could not save`,
  couldNotSaveSettings: () => t`Could not save settings`,
  couldNotDelete: () => t`Could not delete`,
} as const;

/**
 * Appends the server's reason to a failure message: "Could not save:
 * <reason>". Without a reason the message stands alone.
 */
export function withReason(message: string, reason?: string): string {
  return isNonEmptyString(reason) ? `${message}: ${reason}` : message;
}
