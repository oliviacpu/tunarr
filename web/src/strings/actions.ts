// The action vocabulary for the save / cancel / close / delete / reset family: the only
// labels for these actions, and the toast that confirms each one. Use one verb
// through the whole flow (Save -> Saved, Delete -> Deleted). Do not write
// "Update", "Submit", "Reset Options" or "Settings Saved!" by hand. Other verbs
// are added here only together with their first consumer.
//
// Failures: "Could not save settings" is for the settings pages only; every
// other save uses the generic "Could not save".
//
// These are hooks, not constants, so a component that renders them re-renders
// when the locale activates. Call them at component scope and use the strings
// as plain values (callbacks defined in the component close over them).
import { isNonEmptyString } from '@/helpers/util';
import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';

export function useActions() {
  const { t } = useLingui();
  return useMemo(
    () => ({
      save: t`Save`,
      cancel: t`Cancel`,
      close: t`Close`,
      delete: t`Delete`,
      resetChanges: t`Reset changes`,
      restoreDefaults: t`Restore defaults`,
      add: t`Add`,
    }),
    [t],
  );
}

export function useToasts() {
  const { t } = useLingui();
  return useMemo(
    () => ({
      saved: t`Saved`,
      deleted: t`Deleted`,
      changesReset: t`Changes reset`,
      defaultsRestored: t`Defaults restored`,
      couldNotSave: t`Could not save`,
      couldNotSaveSettings: t`Could not save settings`,
      couldNotDelete: t`Could not delete`,
    }),
    [t],
  );
}

/**
 * Appends the server's reason to a failure message: "Could not save:
 * <reason>". Without a reason the message stands alone.
 */
export function withReason(message: string, reason?: string): string {
  return isNonEmptyString(reason) ? `${message}: ${reason}` : message;
}
