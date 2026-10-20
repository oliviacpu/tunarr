import { act, renderWithProviders, screen, waitFor } from '@/test/utils';
import { QueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { Channel } from '@tunarr/types';
import { SnackbarProvider } from 'notistack';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';
import type * as Sdk from '../../generated/sdk.gen.ts';
import { EditChannelForm } from './EditChannelForm.tsx';
import type { EditChannelTabs } from './EditChannelTabPanel.tsx';

type ChannelBody = { channel: Record<string, unknown> };
type UpdateOptions = { path: { id: string }; body: Record<string, unknown> };

const { mockCreate, mockUpdate } = vi.hoisted(() => ({
  mockCreate: vi.fn<(options: { body: ChannelBody }) => Promise<unknown>>(),
  mockUpdate: vi.fn<(options: UpdateOptions) => Promise<unknown>>(),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  createChannelV2: (options: { body: ChannelBody }) => mockCreate(options),
  putApiChannelsById: (options: UpdateOptions) => mockUpdate(options),
}));

// The tabs' own fields have their own tests. These stand in with one required
// field, so the tests see what the editor around them does
vi.mock('./ChannelPropertiesEditor.tsx', async () => {
  const { useFormContext } = await import('react-hook-form');
  return {
    ChannelPropertiesEditor: () => {
      const { register } = useFormContext<{ name: string }>();
      return (
        <label>
          Channel name
          <input {...register('name', { required: 'Enter a name' })} />
        </label>
      );
    },
  };
});
vi.mock('./ChannelFlexConfig.tsx', () => ({
  ChannelFlexConfig: () => <p>Flex fields</p>,
}));
vi.mock('./ChannelEpgConfig.tsx', () => ({
  default: () => <p>Guide fields</p>,
}));
vi.mock('./ChannelTranscodingConfig.tsx', () => ({
  default: () => <p>Streaming fields</p>,
}));

const channel: Channel = {
  id: 'c0ffee00-0000-4000-8000-000000000001',
  name: 'Movie Night',
  number: 1,
  disableFillerOverlay: false,
  duration: 3_600_000,
  groupTitle: 'tunarr',
  guideMinimumDuration: 30_000,
  icon: { path: '', width: 0, duration: 0, position: 'bottom-right' },
  offline: { mode: 'pic' },
  startTime: 1_700_000_000_000,
  stealth: false,
  onDemand: { enabled: false },
  programCount: 10,
  streamMode: 'hls',
  transcodeConfigId: '00000000-0000-0000-0000-000000000000',
  subtitlesEnabled: false,
  sessions: [],
};

const createdId = 'c0ffee00-0000-4000-8000-000000000002';

function renderEditor(mode: 'edit' | 'new') {
  const rootRoute = createRootRoute();
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/channels/$channelId/edit',
    validateSearch: z.object({
      tab: z.enum(['flex', 'epg', 'ffmpeg']).optional(),
    }),
    component: function EditRoute() {
      const { data: loadedChannel } = useSuspenseQuery({
        queryKey: ['test-channel'],
        queryFn: async () => channel,
        staleTime: Infinity,
      });
      const { tab } = editRoute.useSearch();
      const initialTab: EditChannelTabs = tab ?? 'properties';
      return (
        <EditChannelForm
          channel={loadedChannel}
          isNew={false}
          initialTab={initialTab}
        />
      );
    },
  });
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/channels/new',
    component: () => <EditChannelForm channel={channel} isNew={true} />,
  });
  const programmingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/channels/$channelId/programming',
    component: () => <h1>Programming</h1>,
  });
  const channelsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/channels',
    component: () => <h1>Channels</h1>,
  });
  // The unsaved guard needs a history that can block, which the memory
  // history can't
  window.history.replaceState(
    null,
    '',
    mode === 'new' ? '/channels/new' : `/channels/${channel.id}/edit`,
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      editRoute,
      newRoute,
      programmingRoute,
      channelsRoute,
    ]),
    history: createBrowserHistory(),
  });
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  queryClient.setQueryData(['test-channel'], channel);
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <RouterProvider router={router} />
    </SnackbarProvider>,
    { queryClient },
  );
  return { ...rendered, router, queryClient };
}

const nameField = () => screen.findByRole('textbox', { name: 'Channel name' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const unsavedDialog = () =>
  screen.queryByRole('dialog', { name: 'You have unsaved changes!' });

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockImplementation(({ body }) =>
    Promise.resolve({ data: { ...channel, ...body } }),
  );
});

describe('EditChannelForm, editing a channel', () => {
  test('Save is disabled until one valid change, then saves it once', async () => {
    const { user } = renderEditor('edit');
    const name = await nameField();
    expect(saveButton()).toBeDisabled();

    await user.type(name, ' Late');
    await user.tab();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdate.mock.calls[0]?.[0]).toMatchObject({
      path: { id: channel.id },
      body: { name: 'Movie Night Late' },
    });
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  test('editing during an update preserves the newer value as unsaved', async () => {
    let finish: () => void = () => {};
    mockUpdate.mockImplementation(
      ({ body }) =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { ...channel, ...body } });
        }),
    );
    const { user } = renderEditor('edit');
    const name = await nameField();
    await user.type(name, ' Late');
    await user.tab();
    await user.click(saveButton());
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledOnce());
    expect(name).toBeEnabled();
    await user.type(name, ' Edition');
    finish();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(name).toHaveValue('Movie Night Late Edition');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(name).toHaveValue('Movie Night Late');
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  test('session-only refetches keep ordinary unsaved edits', async () => {
    const { user, queryClient } = renderEditor('edit');
    const name = await nameField();
    await user.type(name, ' Draft');
    await user.tab();
    await act(async () => {
      queryClient.setQueryData(['test-channel'], {
        ...channel,
        sessions: [
          { type: 'hls', state: 'started', numConnections: 1, connections: [] },
        ],
      });
    });
    expect(name).toHaveValue('Movie Night Draft');
    expect(saveButton()).toBeEnabled();
  });

  test('a GET refetch after a PUT without sessions keeps post-save edits', async () => {
    let finish: () => void = () => {};
    mockUpdate.mockImplementation(
      ({ body }) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ data: { ...channel, ...body, sessions: undefined } });
        }),
    );
    const { user, queryClient } = renderEditor('edit');
    const name = await nameField();
    await user.type(name, ' Late');
    await user.tab();
    await user.click(saveButton());
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledOnce());
    await user.type(name, ' Draft');
    finish();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await act(async () => {
      queryClient.setQueryData(['test-channel'], {
        ...channel,
        name: 'Movie Night Late',
      });
    });
    expect(name).toHaveValue('Movie Night Late Draft');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(name).toHaveValue('Movie Night Late');
  });

  test('an invalid change keeps Save disabled', async () => {
    const { user } = renderEditor('edit');
    const name = await nameField();
    await user.type(name, ' Late');
    await user.tab();
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.clear(name);
    await user.tab();

    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(
      screen.getByRole('button', { name: 'Reset changes' }),
    ).toBeInTheDocument();
  });

  test('a refused save says why with the generic failure', async () => {
    mockUpdate.mockRejectedValue(new Error('Channel number in use'));
    const { user } = renderEditor('edit');

    await user.type(await nameField(), ' Late');
    await user.tab();
    await user.click(saveButton());

    expect(
      await screen.findByText('Could not save: Channel number in use'),
    ).toBeInTheDocument();
  });

  test('switching tabs with unsaved changes keeps them and does not ask to leave', async () => {
    const { user, router } = renderEditor('edit');
    await user.type(await nameField(), ' Late');
    await user.tab();

    await user.click(screen.getByRole('tab', { name: 'Flex' }));

    expect(await screen.findByText('Flex fields')).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ tab: 'flex' }),
    );
    expect(unsavedDialog()).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Properties' }));
    expect(await nameField()).toHaveValue('Movie Night Late');
    expect(saveButton()).toBeEnabled();
  });

  test('leaving with unsaved changes asks first', async () => {
    const { user, router } = renderEditor('edit');
    await user.type(await nameField(), ' Late');
    await user.tab();

    void router.navigate({ to: '/channels' });

    expect(
      await screen.findByRole('dialog', { name: 'You have unsaved changes!' }),
    ).toBeInTheDocument();
  });
});

describe('EditChannelForm, a new channel', () => {
  test('Save is enabled before any change, while the values are valid', async () => {
    const { user } = renderEditor('new');
    const name = await nameField();

    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.clear(name);
    await user.tab();
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  test('creating locks the fields, then opens the programming page without asking', async () => {
    let answer: (created: Channel) => void = () => {};
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = (created) => resolve({ data: created });
        }),
    );
    const { user, router } = renderEditor('new');
    const name = await nameField();
    await user.clear(name);
    await user.tab();
    await user.type(name, 'Cartoons');
    await user.tab();

    await user.click(saveButton());

    await waitFor(() => expect(mockCreate).toHaveBeenCalledOnce());
    expect(mockCreate.mock.calls[0]?.[0].body.channel).toMatchObject({
      name: 'Cartoons',
    });
    // An edit now would be lost when the page moves on
    expect(name).toBeDisabled();
    await user.type(name, ' Daily');
    expect(name).toHaveValue('Cartoons');

    answer({ ...channel, id: createdId, name: 'Cartoons' });

    expect(
      await screen.findByRole('heading', { name: 'Programming' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      `/channels/${createdId}/programming`,
    );
    expect(unsavedDialog()).not.toBeInTheDocument();
  });

  test('a failed create unlocks the fields and keeps the values', async () => {
    mockCreate.mockRejectedValue(new Error('Channel number in use'));
    const { user } = renderEditor('new');
    const name = await nameField();
    await user.clear(name);
    await user.tab();
    await user.type(name, 'Cartoons');
    await user.tab();

    await user.click(saveButton());

    expect(
      await screen.findByText('Could not save: Channel number in use'),
    ).toBeInTheDocument();
    await waitFor(() => expect(name).toBeEnabled());
    expect(name).toHaveValue('Cartoons');
  });
});
