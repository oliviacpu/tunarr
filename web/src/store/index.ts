import type { Maybe } from '@/types/util.ts';
import { get, isNil, isObject, merge, omit } from 'lodash-es';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  type EditorsState,
  createChannelEditorState,
} from './channelEditor/store.ts';
import type { ProgrammingState } from './programming/store.ts';
import { createProgrammingState } from './programming/store.ts';
import {
  type ProgrammingListingsState,
  createProgrammingListingsState,
} from './programmingSelector/store.ts';
import type { SettingsStateInternal } from './settings/store.ts';
import {
  type PersistedSettingsState,
  type SettingsState,
  SettingsStateInternalSchema,
  createSettingsSlice,
} from './settings/store.ts';
import {
  type ThemeEditorState,
  createThemeEditorState,
} from './themeEditor/store.ts';

export type State = ThemeEditorState &
  SettingsState &
  ProgrammingListingsState &
  EditorsState &
  ProgrammingState;

type PersistedState = PersistedSettingsState & ThemeEditorState;

const useStore = create<State>()(
  immer(
    devtools(
      persist(
        (...set) => ({
          ...createSettingsSlice(...set),
          ...createProgrammingListingsState(...set),
          ...createChannelEditorState(...set),
          ...createThemeEditorState(...set),
          ...createProgrammingState(...set),
        }),
        {
          name: 'tunarr',
          partialize: (state: State) =>
            ({
              theme: state.theme,
              settings: {
                backendUri: state.settings.backendUri,
                ui: {
                  ...state.settings.ui,
                },
              },
            }) satisfies PersistedState,
          merge(persistedState, currentState) {
            if (isNil(persistedState)) {
              return currentState;
            }

            if (!isObject(persistedState)) {
              return currentState;
            }

            const persistedTheme = get(persistedState, 'theme') as unknown;
            const persistedSettings = get(
              persistedState,
              'settings',
            ) as unknown;

            let parsedSettings: Maybe<SettingsStateInternal>;
            if (persistedSettings) {
              const result = SettingsStateInternalSchema.safeParse(
                persistedSettings,
                { reportInput: true },
              );
              if (result.error) {
                console.error(
                  'Could not hydrate persisted settings',
                  result.error,
                );
              } else {
                parsedSettings = result.data;
                // TODO: provide way to convert to the next version
              }
            }

            return {
              ...currentState,
              theme: merge(
                {},
                currentState.theme ?? {},
                // Older builds stored a themePreference that nothing reads
                // (MUI keeps the color mode). Drop it so it isn't merged back
                // into the state and persisted again.
                isObject(persistedTheme)
                  ? omit(persistedTheme, 'themePreference')
                  : {},
              ),
              settings: merge(
                {},
                currentState.settings ?? {},
                parsedSettings ?? {},
              ),
            };
          },
        },
      ),
      // Zustand v4 enables devtools whenever the Redux DevTools extension is
      // present, and the extension serializes the whole store on every update.
      { enabled: import.meta.env.DEV },
    ),
  ),
);

export default useStore;
