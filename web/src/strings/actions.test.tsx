import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { I18nProvider } from '@lingui/react';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { useActions, useToasts, withReason } from './actions';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n}>{children}</I18nProvider>
);

describe('action vocabulary', () => {
  it('has exactly the agreed actions', () => {
    const { result } = renderHook(() => useActions(), { wrapper });
    expect(Object.keys(result.current).sort()).toEqual([
      'add',
      'cancel',
      'close',
      'delete',
      'resetChanges',
      'restoreDefaults',
      'save',
    ]);
  });

  it('has exactly the agreed toasts', () => {
    const { result } = renderHook(() => useToasts(), { wrapper });
    expect(Object.keys(result.current).sort()).toEqual([
      'changesReset',
      'couldNotDelete',
      'couldNotSave',
      'couldNotSaveSettings',
      'defaultsRestored',
      'deleted',
      'saved',
    ]);
  });

  it('gives no two actions the same label', () => {
    const { result } = renderHook(() => useActions(), { wrapper });
    const labels = Object.values(result.current);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives no two toasts the same text', () => {
    const { result } = renderHook(() => useToasts(), { wrapper });
    const texts = Object.values(result.current);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('uses the agreed wording', () => {
    const { result: actions } = renderHook(() => useActions(), { wrapper });
    const { result: toasts } = renderHook(() => useToasts(), { wrapper });
    expect(actions.current.save).toBe('Save');
    expect(actions.current.cancel).toBe('Cancel');
    expect(actions.current.close).toBe('Close');
    expect(actions.current.delete).toBe('Delete');
    expect(actions.current.resetChanges).toBe('Reset changes');
    expect(actions.current.restoreDefaults).toBe('Restore defaults');
    expect(toasts.current.saved).toBe('Saved');
    expect(toasts.current.deleted).toBe('Deleted');
    expect(toasts.current.couldNotSave).toBe('Could not save');
    expect(toasts.current.couldNotSaveSettings).toBe('Could not save settings');
  });

  it('updates dismissal and destructive labels when the locale changes', () => {
    const { result } = renderHook(() => useActions(), { wrapper });
    try {
      act(() =>
        i18n.loadAndActivate({
          locale: 'fr',
          messages: {
            [msg`Cancel`.id]: 'Annuler',
            [msg`Close`.id]: 'Fermer',
            [msg`Delete`.id]: 'Supprimer',
          },
        }),
      );
      expect(result.current).toMatchObject({
        cancel: 'Annuler',
        close: 'Fermer',
        delete: 'Supprimer',
      });
    } finally {
      act(() => i18n.loadAndActivate({ locale: 'en', messages: {} }));
    }
  });

  it('appends a reason only when there is one', () => {
    expect(withReason('Could not save')).toBe('Could not save');
    expect(withReason('Could not save', '')).toBe('Could not save');
    expect(withReason('Could not delete', 'in use')).toBe(
      'Could not delete: in use',
    );
  });
});
