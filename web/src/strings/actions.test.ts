import { describe, expect, it } from 'vitest';
import { actions, toasts, withReason } from './actions';

describe('action vocabulary', () => {
  it('has exactly the agreed actions', () => {
    expect(Object.keys(actions).sort()).toEqual(
      [
        'add',
        'cancel',
        'close',
        'create',
        'delete',
        'remove',
        'resetChanges',
        'restoreDefaults',
        'save',
      ].sort(),
    );
  });

  it('has exactly the agreed toasts', () => {
    expect(Object.keys(toasts).sort()).toEqual(
      [
        'changesReset',
        'couldNotDelete',
        'couldNotSave',
        'couldNotSaveSettings',
        'defaultsRestored',
        'deleted',
        'saved',
      ].sort(),
    );
  });

  it('gives no two actions the same label', () => {
    const labels = Object.values(actions).map((a) => a());
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives no two toasts the same text', () => {
    const texts = Object.values(toasts).map((a) => a());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('uses the agreed wording', () => {
    expect(toasts.couldNotSave()).toBe('Could not save');
    expect(toasts.couldNotSaveSettings()).toBe('Could not save settings');
    expect(actions.save()).toBe('Save');
    expect(actions.resetChanges()).toBe('Reset changes');
    expect(actions.restoreDefaults()).toBe('Restore defaults');
    expect(toasts.saved()).toBe('Saved');
    expect(toasts.deleted()).toBe('Deleted');
  });

  it('appends a reason only when there is one', () => {
    expect(withReason('Could not save')).toBe('Could not save');
    expect(withReason('Could not save', '')).toBe('Could not save');
    expect(withReason('Could not delete', 'in use')).toBe(
      'Could not delete: in use',
    );
  });
});
