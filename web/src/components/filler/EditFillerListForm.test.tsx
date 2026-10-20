import { UnsavedId } from '@/helpers/constants.ts';
import { zipWithIndex } from '@/helpers/util.ts';
import useStore from '@/store/index.ts';
import { setCurrentFillerList } from '@/store/fillerListEditor/action.ts';
import { makeContentProgram, makeMovie } from '@/test/programFixtures.ts';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router';
import type { FillerList } from '@tunarr/types';
import { SnackbarProvider } from 'notistack';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import type ChannelLineupList from '../channel_config/ChannelLineupList.tsx';
import { EditFillerListForm } from './EditFillerListForm.tsx';

type SaveOptions = {
  path?: { id: string };
  body: { name: string; programs: unknown[] };
};

const { mockCreate, mockUpdate } = vi.hoisted(() => ({
  mockCreate: vi.fn<(options: SaveOptions) => Promise<unknown>>(),
  mockUpdate: vi.fn<(options: SaveOptions) => Promise<unknown>>(),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  postApiFillerLists: (options: SaveOptions) => mockCreate(options),
  putApiFillerListsById: (options: SaveOptions) => mockUpdate(options),
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

const fillerList: FillerList = {
  id: 'f111e700-0000-4000-8000-000000000001',
  name: 'Bumpers',
  contentCount: 2,
};

const newList: FillerList = {
  id: UnsavedId,
  name: 'New Filler List',
  contentCount: 0,
};

const programs = [
  makeContentProgram(makeMovie({ uuid: 'movie-1', title: 'Intro' }), 30_000),
  makeContentProgram(makeMovie({ uuid: 'movie-2', title: 'Outro' }), 30_000),
];

function AddProgramsPage({ back }: { back: string }) {
  const navigate = useNavigate();
  return (
    <>
      <h1>Add programs</h1>
      <button type="button" onClick={() => void navigate({ to: back })}>
        Done
      </button>
    </>
  );
}

function renderEditor(mode: 'edit' | 'new') {
  const rootRoute = createRootRoute();
  const editPath = `/library/fillers/${fillerList.id}/edit`;
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/library/fillers/$fillerId/edit',
      component: () => (
        <EditFillerListForm fillerList={fillerList} isNew={false} />
      ),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/library/fillers/$fillerId/programming',
      component: () => <AddProgramsPage back={editPath} />,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/library/fillers/new',
      component: () => <EditFillerListForm fillerList={newList} isNew />,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/library/fillers',
      component: () => <h1>Filler Lists</h1>,
    }),
  ];
  // The unsaved guard needs a history that can block, which the memory
  // history can't
  window.history.replaceState(
    null,
    '',
    mode === 'new' ? '/library/fillers/new' : editPath,
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createBrowserHistory(),
  });
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <RouterProvider router={router} />
    </SnackbarProvider>,
    { queryClient },
  );
  return { ...rendered, router };
}

const nameField = () => screen.findByRole('textbox', { name: 'Name' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const removeFirstProgram = () =>
  screen.getByRole('button', { name: 'Remove first program' });
const unsavedDialog = () =>
  screen.queryByRole('dialog', { name: 'You have unsaved changes!' });
const draft = () => useStore.getState().fillerListEditor;

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockImplementation(({ body }) =>
    Promise.resolve({ data: { ...fillerList, name: body.name } }),
  );
  setCurrentFillerList(fillerList, programs);
});

describe('EditFillerListForm, editing a list', () => {
  test('Save is disabled until one valid change, then saves the name and programs', async () => {
    const { user } = renderEditor('edit');
    const name = await nameField();
    expect(saveButton()).toBeDisabled();

    await user.type(name, ' 2');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdate.mock.calls[0]?.[0]).toMatchObject({
      path: { id: fillerList.id },
      body: { name: 'Bumpers 2' },
    });
    expect(mockUpdate.mock.calls[0]?.[0].body.programs).toHaveLength(2);
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(draft().originalEntity?.name).toBe('Bumpers 2');
  });

  test('a changed program draft enables Save and Reset changes', async () => {
    const { user } = renderEditor('edit');
    await nameField();

    await user.click(removeFirstProgram());

    expect(screen.getByText('1 programs')).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(screen.getByText('2 programs')).toBeInTheDocument();
    expect(draft().dirty.programs).toBe(false);
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  test('leaving with a changed program draft asks first, and Proceed throws the draft away', async () => {
    const { user, router } = renderEditor('edit');
    await nameField();
    await user.click(removeFirstProgram());

    void router.navigate({ to: '/library/fillers' });

    const dialog = await screen.findByRole('dialog', {
      name: 'You have unsaved changes!',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Proceed' }));
    expect(
      await screen.findByRole('heading', { name: 'Filler Lists' }),
    ).toBeInTheDocument();
    expect(draft().programList).toHaveLength(2);
    expect(draft().dirty.programs).toBe(false);
  });

  test('going to add programs does not ask, and the changes are still there on return', async () => {
    const { user } = renderEditor('edit');
    await user.type(await nameField(), ' 2');
    await user.click(removeFirstProgram());

    await user.click(
      screen.getByRole('button', { name: 'Add TV Shows or Movies to filler' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Add programs' }),
    ).toBeInTheDocument();
    expect(unsavedDialog()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(await nameField()).toHaveValue('Bumpers 2');
    expect(screen.getByText('1 programs')).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  test('Save stays disabled while the list has no programs', async () => {
    const { user } = renderEditor('edit');
    await nameField();

    await user.click(screen.getByRole('button', { name: 'Clear All' }));

    expect(screen.getByText('0 programs')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reset changes' }),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});

describe('EditFillerListForm, a new list', () => {
  beforeEach(() => {
    setCurrentFillerList(newList, []);
    useStore.setState(({ fillerListEditor }) => {
      fillerListEditor.programList = zipWithIndex(programs);
      fillerListEditor.dirty.programs = true;
    });
  });

  test('creating locks the fields, then opens the lists without asking and empties the draft', async () => {
    let answer: () => void = () => {};
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ data: { id: 'created-list' } });
        }),
    );
    const { user, router } = renderEditor('new');
    const name = await nameField();
    await user.clear(name);
    await user.type(name, 'Station IDs');

    await user.click(saveButton());

    await waitFor(() => expect(mockCreate).toHaveBeenCalledOnce());
    expect(mockCreate.mock.calls[0]?.[0].body).toMatchObject({
      name: 'Station IDs',
    });
    expect(name).toBeDisabled();
    expect(removeFirstProgram()).toBeDisabled();

    answer();

    expect(
      await screen.findByRole('heading', { name: 'Filler Lists' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/library/fillers');
    expect(unsavedDialog()).not.toBeInTheDocument();
    expect(draft().currentEntity).toBeUndefined();
    expect(draft().dirty.programs).toBe(false);
  });
});
