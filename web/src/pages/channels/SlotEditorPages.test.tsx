import useStore from '@/store/index.ts';
import { setCurrentChannel } from '@/store/channelEditor/actions.ts';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { Channel } from '@tunarr/types';
import type { RandomSlotSchedule, TimeSlotSchedule } from '@tunarr/types/api';
import { SnackbarProvider } from 'notistack';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getApiChannelsByIdScheduleQueryKey } from '../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../generated/sdk.gen.ts';
import RandomSlotEditorPage from './RandomSlotEditorPage.tsx';
import TimeSlotEditorPage from './TimeSlotEditorPage.tsx';

type LineupSave = {
  path: { id: string };
  body: { type: string; schedule: { maxDays: number } };
};

const { mockSave } = vi.hoisted(() => ({
  mockSave: vi.fn<(options: LineupSave) => Promise<unknown>>(),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  postApiChannelsByIdProgramming: (options: LineupSave) => mockSave(options),
}));

// The slot tables, the program options, the lineup preview and the
// breadcrumbs have their own tests and data; these tests are about the save
// bar around them
vi.mock('../../components/slot_scheduler/TimeSlotTable.tsx', () => ({
  TimeSlotTable: () => null,
}));
vi.mock('../../components/slot_scheduler/RandomSlotTable.tsx', () => ({
  RandomSlotTable: () => null,
}));
vi.mock('../../components/channel_config/ChannelLineupList.tsx', () => ({
  default: () => null,
}));
vi.mock('../../components/Breadcrumbs.tsx', () => ({
  default: () => null,
}));
vi.mock('../../hooks/programming_controls/useSlotProgramOptions.ts', () => ({
  useSlotProgramOptions: () => ({ dropdownOpts: [], nameById: {} }),
}));
// Refresh Preview puts a new lineup in the channel's draft, as the real one
// does once the server has scheduled it
vi.mock('../../hooks/slot_scheduler/useScheduleSlots.ts', async () => {
  const { setCurrentLineup } = await import(
    '../../store/channelEditor/actions.ts'
  );
  const schedule = () => {
    setCurrentLineup([], true);
    return Promise.resolve({
      programs: [],
      startTime: 1_700_000_000_000,
      seed: [1, 2, 3],
      discardCount: 0,
    });
  };
  return {
    useScheduleSlots: () => ({
      scheduleTimeSlots: schedule,
      scheduleSlots: schedule,
    }),
  };
});

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
  programCount: 0,
  streamMode: 'hls',
  transcodeConfigId: '00000000-0000-0000-0000-000000000000',
  subtitlesEnabled: false,
  sessions: [],
};

const timeSchedule: TimeSlotSchedule = {
  type: 'time',
  flexPreference: 'distribute',
  latenessMs: 0,
  maxDays: 365,
  overflow: { type: 'duration', maxMs: 0 },
  padMs: 1,
  period: 'day',
  slots: [{ type: 'flex', startTime: 0 }],
  timeZoneOffset: 0,
};

const randomSchedule: RandomSlotSchedule = {
  type: 'random',
  flexPreference: 'distribute',
  maxDays: 365,
  padMs: 1,
  padStyle: 'slot',
  randomDistribution: 'uniform',
  lockWeights: false,
  slots: [
    {
      type: 'flex',
      cooldownMs: 0,
      weight: 100,
      index: 0,
      durationSpec: { type: 'dynamic', programCount: 1 },
    },
  ],
};

function renderEditor(editor: 'time' | 'random') {
  const rootRoute = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/channels/$channelId/programming/time-slot-editor',
      component: TimeSlotEditorPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/channels/$channelId/programming/slot-editor',
      component: RandomSlotEditorPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/channels/$channelId/programming',
      component: () => <h1>Programming</h1>,
    }),
  ];
  // The unsaved guard needs a history that can block, which the memory
  // history can't
  window.history.replaceState(
    null,
    '',
    `/channels/${channel.id}/programming/${
      editor === 'time' ? 'time-slot-editor' : 'slot-editor'
    }`,
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
    getApiChannelsByIdScheduleQueryKey({ path: { id: channel.id } }),
    { schedule: editor === 'time' ? timeSchedule : randomSchedule },
  );
  const rendered = renderWithProviders(
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <SnackbarProvider>
        <RouterProvider router={router} />
      </SnackbarProvider>
    </LocalizationProvider>,
    { queryClient },
  );
  return { ...rendered, router };
}

const daysField = () =>
  screen.findByRole('textbox', { name: 'Days to Precalculate' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  mockSave.mockReset();
  mockSave.mockImplementation(({ body }) =>
    Promise.resolve({
      data: { lineup: [], programs: {}, schedule: body.schedule },
    }),
  );
  setCurrentChannel(channel);
  useStore.setState(({ channelEditor }) => {
    channelEditor.programList = [];
    channelEditor.originalProgramList = [];
    channelEditor.dirty.programs = false;
  });
});

describe.each([
  ['time', 'Time slot editor'],
  ['random', 'Random slot editor'],
] as const)('%s slots: %s', (editor) => {
  test('Save is disabled until one valid change, then saves the schedule', async () => {
    const { user } = renderEditor(editor);
    const days = await daysField();
    expect(saveButton()).toBeDisabled();

    await user.clear(days);
    await user.type(days, '30');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(mockSave).toHaveBeenCalledOnce();
    expect(mockSave.mock.calls[0]?.[0]).toMatchObject({
      path: { id: channel.id },
      body: { type: editor, schedule: { maxDays: 30 } },
    });
    // What was saved is what the form now compares against
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  test('a refreshed preview can be saved, and Reset changes puts the saved lineup back', async () => {
    const { user } = renderEditor(editor);
    await daysField();

    await user.click(screen.getByRole('button', { name: 'Refresh Preview' }));

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(useStore.getState().channelEditor.dirty.programs).toBe(false);
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  test('leaving with unsaved changes asks first, and Proceed drops the preview', async () => {
    const { user, router } = renderEditor(editor);
    await daysField();
    await user.click(screen.getByRole('button', { name: 'Refresh Preview' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.click(screen.getByRole('link', { name: 'Back to Programming' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'You have unsaved changes!',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Proceed' }));
    expect(
      await screen.findByRole('heading', { name: 'Programming' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      `/channels/${channel.id}/programming`,
    );
    expect(useStore.getState().channelEditor.dirty.programs).toBe(false);
  });
});
