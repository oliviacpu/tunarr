import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { Task } from '@tunarr/types';
import type { GlobalMediaSourceSettings } from '@tunarr/types/schemas';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Generated from '../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../generated/sdk.gen.ts';
import { ScannerSettingsPage } from './ScannerSettingsPage.tsx';

// The app extends this in main.tsx
dayjs.extend(localizedFormat);

// 12:30 and 10:30 on 19 Oct 2026, local time
const SixHourScan = dayjs(new Date(2026, 9, 19, 12, 30)).unix();
const HourlyScan = dayjs(new Date(2026, 9, 19, 10, 30)).unix();

function scanTask(nextExecutionEpoch: number): Task {
  return {
    id: 'ScanLibrariesTask',
    name: 'ScanLibrariesTask',
    description: 'Initiates a scan of all enabled libraries and media sources',
    scheduledTasks: [{ running: false, nextExecutionEpoch, args: undefined }],
  };
}

// What the server has; a save changes it as the server would
const { server, mockPutSettings } = vi.hoisted(() => ({
  server: {
    settings: { rescanIntervalHours: 6 } as GlobalMediaSourceSettings,
    tasks: [] as Task[],
  },
  mockPutSettings: vi.fn(),
}));

vi.mock(
  '../../generated/@tanstack/react-query.gen.ts',
  async (importOriginal) => ({
    ...(await importOriginal<typeof Generated>()),
    getApiSettingsMediaSourceOptions: () => ({
      queryKey: ['test-media-source-settings'],
      queryFn: () => Promise.resolve(server.settings),
    }),
    getApiTasksOptions: () => ({
      queryKey: ['test-tasks'],
      queryFn: () => Promise.resolve(server.tasks),
    }),
    getApiTasksQueryKey: () => ['test-tasks'],
  }),
);

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  putApiSettingsMediaSource: (options: { body: GlobalMediaSourceSettings }) =>
    mockPutSettings(options),
}));

const IntervalLabel = 'Rescan interval (hours)';

async function renderPage() {
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <ScannerSettingsPage />
      </Suspense>
    </SnackbarProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText(IntervalLabel)).toHaveValue(
      String(server.settings.rescanIntervalHours),
    ),
  );
  const { user } = rendered;
  const setRescanInterval = async (value: string) => {
    const field = screen.getByLabelText(IntervalLabel);
    await user.clear(field);
    await user.type(field, value);
    await user.tab();
  };
  const save = () => user.click(screen.getByRole('button', { name: 'Save' }));
  return { ...rendered, setRescanInterval, save };
}

const nextScanText = (epoch: number) =>
  `Next scan: ${dayjs(epoch * 1000).format('llll')}`;

describe('ScannerSettingsPage', () => {
  beforeEach(() => {
    server.settings = { rescanIntervalHours: 6 };
    server.tasks = [scanTask(SixHourScan)];
    // The server moves the scheduled scan to the interval it saves
    mockPutSettings.mockReset();
    mockPutSettings.mockImplementation(
      (options: { body: GlobalMediaSourceSettings }) => {
        server.settings = options.body;
        server.tasks = [scanTask(HourlyScan)];
        return Promise.resolve({ data: options.body });
      },
    );
  });

  test('shows when the server will next scan', async () => {
    await renderPage();

    expect(
      await screen.findByText(nextScanText(SixHourScan)),
    ).toBeInTheDocument();
  });

  test('after a new interval is saved, shows the next scan the server moved it to', async () => {
    const { setRescanInterval, save } = await renderPage();
    await screen.findByText(nextScanText(SixHourScan));

    await setRescanInterval('1');
    await save();

    await waitFor(() => expect(mockPutSettings).toHaveBeenCalledOnce());
    expect(mockPutSettings.mock.calls[0]?.[0]).toMatchObject({
      body: { rescanIntervalHours: 1 },
    });
    expect(
      await screen.findByText(nextScanText(HourlyScan)),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(nextScanText(SixHourScan)),
    ).not.toBeInTheDocument();
  });

  test('says nothing about the next scan when none is scheduled', async () => {
    server.tasks = [];
    await renderPage();

    expect(screen.queryByText(/Next scan/)).not.toBeInTheDocument();
  });

  test('an interval under 1 hour is flagged and not saved', async () => {
    const { setRescanInterval, save } = await renderPage();

    await setRescanInterval('0');
    await save();

    // Its helper text, which starts with its error, is its accessible
    // description
    const field = screen.getByLabelText(IntervalLabel);
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(
        expect.stringContaining('Rescan interval must be at least 1 hour.'),
      ),
    );
    expect(field).toBeInvalid();
    expect(mockPutSettings).not.toHaveBeenCalled();
  });
});
