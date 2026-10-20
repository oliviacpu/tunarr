import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { ThemeProvider, createTheme } from '@mui/material';
import { cleanup, render, screen } from '@testing-library/react';
import type { Channel, ChannelProgram } from '@tunarr/types';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import localeData from 'dayjs/plugin/localeData';
import type { ReactElement } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setCurrentChannel } from '../../store/channelEditor/actions.ts';
import useStore from '../../store/index.ts';
import { schemePalette } from '../../test/contrast.ts';
import {
  makeContentProgram,
  makeEpisode,
  makeShowGrouping,
} from '../../test/programFixtures.ts';
import type { UIChannelProgram } from '../../types/index.ts';
import {
  guideColorKey,
  programColor,
  typeStyle,
} from '../guide/guideColors.ts';
import { ProgramDayCalendarView } from '../slot_scheduler/ProgramDayCalendarView.tsx';
import { ProgramWeekCalendarView } from '../slot_scheduler/ProgramWeekCalendarView.tsx';
import ChannelLineupList from './ChannelLineupList.tsx';
import { MidRollGroupRow } from './MidRollGroupRow.tsx';

dayjs.extend(localizedFormat);
dayjs.extend(localeData);

vi.mock('../../hooks/useSuspendedStore.ts', () => ({
  useSuspendedStore: () => channel,
}));
vi.mock('../../hooks/calendarHooks.ts', () => ({
  useGetProgramsForDayFunc: () => (day: dayjs.Dayjs) => [
    {
      duration: 3_600_000,
      howFarIntoDay: 0,
      actualStartTime: day,
      program: episode,
    },
    {
      duration: 3_600_000,
      howFarIntoDay: 3_600_000,
      actualStartTime: day.add(1, 'hour'),
      program: redirect,
    },
    {
      duration: 3_600_000,
      howFarIntoDay: 7_200_000,
      actualStartTime: day.add(2, 'hour'),
      program: flex,
    },
  ],
}));
vi.mock('../../hooks/useProgramTitleFormatter.ts', () => ({
  useProgramTitleFormatter: () => (program: ChannelProgram) =>
    program.type === 'content' ? program.program.title : program.type,
}));
vi.mock('../programming_controls/AddFlexModal.tsx', () => ({
  default: () => null,
}));
vi.mock('../programming_controls/AddRedirectModal.tsx', () => ({
  default: () => null,
}));
vi.mock('../programs/ProgramDetailsDialog.tsx', () => ({
  default: () => null,
}));

const channel: Channel = {
  id: 'channel-1',
  number: 1,
  name: 'Test channel',
  groupTitle: 'tunarr',
  duration: 3_600_000,
  startTime: 0,
  stealth: false,
  disableFillerOverlay: false,
  guideMinimumDuration: 30_000,
  icon: { path: '', width: 0, duration: 0, position: 'bottom-right' },
  offline: { mode: 'pic' },
  onDemand: { enabled: false },
  programCount: 3,
  streamMode: 'hls',
  transcodeConfigId: '00000000-0000-4000-8000-000000000001',
  subtitlesEnabled: false,
};
const episode: UIChannelProgram = {
  ...makeContentProgram(
    makeEpisode({ title: 'Episode title', show: makeShowGrouping('show-1') }),
    3_600_000,
  ),
  uiIndex: 0,
  originalIndex: 0,
  startTimeOffset: 0,
};
const redirect: UIChannelProgram = {
  type: 'redirect',
  channel: 'other-channel',
  channelNumber: 2,
  channelName: 'Other channel',
  duration: 3_600_000,
  uiIndex: 1,
  originalIndex: 1,
  startTimeOffset: 3_600_000,
};
const flex: UIChannelProgram = {
  type: 'flex',
  duration: 3_600_000,
  uiIndex: 2,
  originalIndex: 2,
  startTimeOffset: 7_200_000,
};
const theme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: { palette: schemePalette('light') },
    dark: { palette: schemePalette('dark') },
  },
});
const originalEditor = useStore.getState().channelEditor;

function renderInScheme(element: ReactElement, scheme: 'light' | 'dark') {
  return render(
    <I18nProvider i18n={i18n}>
      <DndProvider backend={HTML5Backend}>
        <ThemeProvider theme={theme} defaultMode={scheme}>
          {element}
        </ThemeProvider>
      </DndProvider>
    </I18nProvider>,
  );
}

const toRgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

describe('lineup presentation in the active scheme', () => {
  beforeEach(() => {
    localStorage.clear();
    setCurrentChannel(channel);
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    useStore.setState((state) => {
      state.channelEditor = originalEditor;
    });
  });

  test.each(['light', 'dark'] as const)(
    'lineup uses guide categories, icons and tabular counts/times in %s',
    (scheme) => {
      renderInScheme(
        <ChannelLineupList
          type="direct"
          programList={[episode, redirect, flex]}
          enableDnd={false}
        />,
        scheme,
      );
      const palette = schemePalette(scheme);
      const row = screen
        .getByText('Episode title')
        .closest('.MuiListItem-root');
      if (row === null) throw new Error('Episode row missing');
      expect(getComputedStyle(row).backgroundImage).toContain(
        toRgb(programColor(palette, guideColorKey(episode))),
      );
      expect(getComputedStyle(row).fontVariantNumeric).toBe('tabular-nums');
      expect(row.querySelector('[data-testid="TvIcon"]')).toBeInTheDocument();
      const redirectRow = screen
        .getByText('redirect')
        .closest('.MuiListItem-root');
      const flexRow = screen.getByText('flex').closest('.MuiListItem-root');
      if (redirectRow === null || flexRow === null)
        throw new Error('Semantic rows missing');
      expect(getComputedStyle(redirectRow).backgroundImage).toContain(
        toRgb(typeStyle(palette, 'redirect').background),
      );
      expect(getComputedStyle(flexRow).outline).toBe(
        `1px dashed ${palette.divider}`,
      );
      expect(
        getComputedStyle(screen.getByText('3 programs').parentElement ?? row)
          .fontVariantNumeric,
      ).toBe('tabular-nums');
    },
  );

  test.each(['light', 'dark'] as const)(
    'mid-roll header keeps program colour and toggle behavior in %s',
    async (scheme) => {
      const onToggle = vi.fn();
      renderInScheme(
        <MidRollGroupRow
          group={{
            parentProgram: episode,
            items: [episode, flex, episode],
            breakCount: 1,
            totalDuration: 10_800_000,
            groupKey: 0,
            startTimeOffset: 0,
          }}
          expanded={false}
          onToggle={onToggle}
          titleFormatter={() => 'Mid-roll title'}
          channel={channel}
          showProgramStartTime
        />,
        scheme,
      );
      const row = screen
        .getByText('Mid-roll title')
        .closest('.MuiListItem-root');
      if (row === null) throw new Error('Mid-roll row missing');
      expect(getComputedStyle(row).backgroundColor).toBe(
        toRgb(programColor(schemePalette(scheme), guideColorKey(episode))),
      );
      expect(getComputedStyle(row).fontVariantNumeric).toBe('tabular-nums');
      screen.getByRole('button').click();
      expect(onToggle).toHaveBeenCalledOnce();
      expect(screen.getByText('1 break')).toBeInTheDocument();
    },
  );

  for (const [name, View] of [
    ['day', ProgramDayCalendarView],
    ['week', ProgramWeekCalendarView],
  ] as const) {
    test.each(['light', 'dark'] as const)(
      `${name} calendar uses guide grouping, semantic redirect and tabular time in %s`,
      (scheme) => {
        const { container } = renderInScheme(
          <View calendarState={dayjs('2026-10-20')} />,
          scheme,
        );
        const cards = [...container.querySelectorAll('.MuiPaper-root')];
        const palette = schemePalette(scheme);
        const fills = cards.map(
          (card) => getComputedStyle(card).backgroundColor,
        );
        expect(fills).toContain(
          toRgb(programColor(palette, guideColorKey(episode))),
        );
        expect(fills).toContain(
          toRgb(typeStyle(palette, 'redirect').background),
        );
        expect(cards).toHaveLength(name === 'day' ? 2 : 14);
        const root = container.querySelector('.MuiStack-root');
        if (root === null) throw new Error('Calendar missing');
        expect(getComputedStyle(root).fontVariantNumeric).toBe('tabular-nums');
      },
    );
  }
});
