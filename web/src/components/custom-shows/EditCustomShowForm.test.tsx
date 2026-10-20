import { UnsavedId } from '@/helpers/constants.ts';
import { zipWithIndex } from '@/helpers/util.ts';
import useStore from '@/store/index.ts';
import { condenseCustomShowEditorPrograms } from '@/store/selectors.ts';
import { makeContentProgram, makeMovie } from '@/test/programFixtures.ts';
import {
  act,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/test/utils';
import { QueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router';
import type { CustomShow } from '@tunarr/types';
import { SnackbarProvider } from 'notistack';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getApiCustomShowsByIdQueryKey } from '../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../generated/sdk.gen.ts';
import type ChannelLineupList from '../channel_config/ChannelLineupList.tsx';
import { customShowQuery } from '../../hooks/useCustomShows.ts';
import { EditCustomShowsForm } from './EditCustomShowForm.tsx';

type SaveOptions = {
  path?: { id: string };
  body: { name: string; programs?: unknown[]; enableSync?: boolean };
};

const { mockCreate, mockUpdate } = vi.hoisted(() => ({
  mockCreate: vi.fn<(options: SaveOptions) => Promise<unknown>>(),
  mockUpdate: vi.fn<(options: SaveOptions) => Promise<unknown>>(),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  createCustomShow: (options: SaveOptions) => mockCreate(options),
  putApiCustomShowsById: (options: SaveOptions) => mockUpdate(options),
  getApiMediaSources: () => Promise.resolve({ data: [] }),
  getApiPlexByMediaSourceIdPlaylists: () =>
    Promise.resolve({ data: { result: [] } }),
}));

// The program list has its own rendering; this one shows the draft and can
// remove its first program, as a row's delete button does
vi.mock('../channel_config/ChannelLineupList.tsx', async () => {
  const { default: useStore } = await import('../../store/index.ts');
  return {
    default: (props: ComponentProps<typeof ChannelLineupList>) => {
      const programs = useStore((s) =>
        props.type === 'selector' && props.programListSelector
          ? props.programListSelector(s)
          : [],
      );
      return (
        <div>
          <p>{programs.length} programs</p>
          <button type="button" onClick={() => props.deleteProgram?.(0)}>
            Remove first program
          </button>
        </div>
      );
    },
  };
});

vi.mock('./CustomShowSortToolsMenu.tsx', () => ({
  CustomShowSortToolsMenu: () => null,
}));

const show: CustomShow = {
  id: 'c057000a-0000-4000-8000-000000000001',
  name: 'Saturday Matinee',
  contentCount: 2,
  schedulableContentCount: 2,
  totalDuration: 60_000,
  isSyncing: false,
};

const newShow: CustomShow = {
  id: UnsavedId,
  name: '',
  contentCount: 0,
  schedulableContentCount: 0,
  totalDuration: 0,
  isSyncing: false,
};

const programs = [
  makeContentProgram(makeMovie({ uuid: 'movie-1', title: 'Intro' }), 30_000),
  makeContentProgram(makeMovie({ uuid: 'movie-2', title: 'Outro' }), 30_000),
];

function loadDraft(entity: CustomShow, list: typeof programs) {
  useStore.setState(({ customShowEditor }) => {
    delete customShowEditor.formValues;
    customShowEditor.currentEntity = entity;
    customShowEditor.originalEntity = entity;
    customShowEditor.programList = zipWithIndex(list);
    customShowEditor.originalProgramList = zipWithIndex(list);
    customShowEditor.dirty.programs = false;
  });
}

function useDraftPrograms() {
  return useStore((s) =>
    condenseCustomShowEditorPrograms(s.customShowEditor.programList),
  );
}

function EditRoute() {
  // As the edit page does: the show from its query, the programs from the
  // draft
  const { data } = useSuspenseQuery(customShowQuery(show.id));
  return (
    <EditCustomShowsForm
      customShow={data}
      customShowPrograms={useDraftPrograms()}
      isNew={false}
    />
  );
}

function NewRoute() {
  return (
    <EditCustomShowsForm
      customShow={newShow}
      customShowPrograms={useDraftPrograms()}
      isNew
    />
  );
}

function AddProgramsPage() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() =>
        void navigate({
          to: '/library/custom-shows/$showId/edit',
          params: { showId: show.id },
        })
      }
    >
      Done adding
    </button>
  );
}

function renderEditor(mode: 'edit' | 'new') {
  const rootRoute = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/library/custom-shows/$showId/programming',
      component: AddProgramsPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/library/custom-shows/$showId/edit',
      component: EditRoute,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/library/custom-shows/new',
      component: NewRoute,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/library/custom-shows',
      component: () => <h1>Custom Shows</h1>,
    }),
  ];
  // The unsaved guard needs a history that can block, which the memory
  // history can't
  window.history.replaceState(
    null,
    '',
    mode === 'new'
      ? '/library/custom-shows/new'
      : `/library/custom-shows/${show.id}/edit`,
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createBrowserHistory(),
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(
    getApiCustomShowsByIdQueryKey({ path: { id: show.id } }),
    show,
  );
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <RouterProvider router={router} />
    </SnackbarProvider>,
    { queryClient },
  );
  return { ...rendered, router, queryClient };
}

const nameField = () => screen.findByRole('textbox', { name: 'Name' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const removeFirstProgram = () =>
  screen.getByRole('button', { name: 'Remove first program' });
const draft = () => useStore.getState().customShowEditor;

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockImplementation(({ body }) =>
    Promise.resolve({ data: { ...show, name: body.name } }),
  );
  loadDraft(show, programs);
});

describe('EditCustomShowsForm, editing a show', () => {
  test('Save is disabled until one valid change, then saves the name and programs', async () => {
    const { user } = renderEditor('edit');
    const name = await nameField();
    expect(saveButton()).toBeDisabled();

    await user.type(name, ' Encore');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdate.mock.calls[0]?.[0]).toMatchObject({
      path: { id: show.id },
      body: { name: 'Saturday Matinee Encore', enableSync: false },
    });
    expect(mockUpdate.mock.calls[0]?.[0].body.programs).toHaveLength(2);
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(draft().originalEntity?.name).toBe('Saturday Matinee Encore');
  });

  test('repeated resets restore the program list saved by the preceding request', async () => {
    const { user } = renderEditor('edit');
    await user.type(await nameField(), ' Saved');
    await user.click(saveButton());
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    for (let edit = 0; edit < 2; edit++) {
      await user.click(removeFirstProgram());
      expect(draft().programList).toHaveLength(1);
      expect(draft().originalProgramList).toHaveLength(2);
      await user.click(screen.getByRole('button', { name: 'Reset changes' }));
      expect(draft().programList).toHaveLength(2);
      expect(draft().originalProgramList).toHaveLength(2);
    }
  });

  test('Add Media preserves an unsaved change that disables external sync', async () => {
    const { user, queryClient } = renderEditor('edit');
    await nameField();
    await act(async () => {
      queryClient.setQueryData(
        getApiCustomShowsByIdQueryKey({ path: { id: show.id } }),
        {
          ...show,
          syncMediaSourceId: 'plex-source',
          syncExternalPlaylistId: 'playlist',
        },
      );
    });
    const sync = screen.getByRole('checkbox', {
      name: 'Sync with external playlist',
    });
    await waitFor(() => expect(sync).toBeChecked());
    await user.click(sync);
    await user.click(
      screen.getByRole('button', { name: 'Add programming to custom show' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Done adding' }),
    );
    const restored = await screen.findByRole('checkbox', {
      name: 'Sync with external playlist',
    });
    expect(restored).not.toBeChecked();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(restored).toBeChecked();
  });

  test('leaving with a changed program draft asks first, and Proceed throws the draft away', async () => {
    const { user, router } = renderEditor('edit');
    await nameField();
    await user.click(removeFirstProgram());
    await waitFor(() => expect(saveButton()).toBeEnabled());

    void router.navigate({ to: '/library/custom-shows' });

    const dialog = await screen.findByRole('dialog', {
      name: 'You have unsaved changes!',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Proceed' }));
    expect(
      await screen.findByRole('heading', { name: 'Custom Shows' }),
    ).toBeInTheDocument();
    expect(draft().programList).toHaveLength(2);
    expect(draft().dirty.programs).toBe(false);
  });

  test("a reload of the show, as while it syncs, keeps the user's changes", async () => {
    const { user, queryClient } = renderEditor('edit');
    const name = await nameField();
    await user.type(name, ' Encore');

    // The query tells its readers on a later tick; let the page render it
    await act(async () => {
      queryClient.setQueryData(
        getApiCustomShowsByIdQueryKey({ path: { id: show.id } }),
        { ...show, isSyncing: true, lastSyncedAt: 1_700_000_000_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(name).toHaveValue('Saturday Matinee Encore');
    expect(saveButton()).toBeEnabled();
  });
});

describe('EditCustomShowsForm, a new show', () => {
  beforeEach(() => {
    loadDraft(newShow, []);
    useStore.setState(({ customShowEditor }) => {
      customShowEditor.programList = zipWithIndex(programs);
      customShowEditor.dirty.programs = true;
    });
  });

  test('creating locks the fields, then opens the shows without asking and empties the draft', async () => {
    let answer: () => void = () => {};
    mockCreate.mockImplementation(
      ({ body }) =>
        new Promise((resolve) => {
          answer = () =>
            resolve({ data: { ...show, id: 'created-show', name: body.name } });
        }),
    );
    const { user, router } = renderEditor('new');
    const name = await nameField();
    await user.type(name, 'Cartoon Hour');

    await user.click(saveButton());

    await waitFor(() => expect(mockCreate).toHaveBeenCalledOnce());
    expect(mockCreate.mock.calls[0]?.[0].body).toMatchObject({
      name: 'Cartoon Hour',
    });
    expect(name).toBeDisabled();
    expect(removeFirstProgram()).toBeDisabled();

    answer();

    expect(
      await screen.findByRole('heading', { name: 'Custom Shows' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/library/custom-shows');
    expect(
      screen.queryByRole('dialog', { name: 'You have unsaved changes!' }),
    ).not.toBeInTheDocument();
    expect(draft().currentEntity).toBeUndefined();
  });
});
