import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createTheme, ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import localeData from 'dayjs/plugin/localeData';
import { describe, expect, test, vi } from 'vitest';
import { ProgramWeekCalendarView } from './ProgramWeekCalendarView.tsx';

dayjs.extend(localeData);
vi.mock('../../hooks/useSuspendedStore.ts', () => ({
  useSuspendedStore: () => ({ id: 'channel' }),
}));
vi.mock('../../hooks/calendarHooks.ts', () => ({
  useGetProgramsForDayFunc: () => () => [],
}));
vi.mock('../programs/ProgramDetailsDialog.tsx', () => ({
  default: () => null,
}));

describe('week calendar navigation', () => {
  test('keeps later-day selection and week navigation while zooming the shared calendar', async () => {
    const onChange = vi.fn();
    const onSelectDay = vi.fn();
    const user = userEvent.setup();
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme={createTheme({ cssVariables: true })}>
          <ProgramWeekCalendarView
            calendarState={dayjs('2026-10-20')}
            onChange={onChange}
            onSelectDay={onSelectDay}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    const viewport = screen.getByRole('region', { name: 'Week calendar' });
    expect(viewport).toHaveAttribute('tabindex', '0');
    await user.click(screen.getByText('24', { exact: true }));
    const selected: unknown = onSelectDay.mock.calls[0]?.[0];
    if (!dayjs.isDayjs(selected)) throw new Error('Selected day missing');
    expect(selected.format('YYYY-MM-DD')).toBe('2026-10-24');
    const clickIcon = async (name: string) => {
      const button = screen.getByTestId(name).closest('button');
      if (button === null) throw new Error('Calendar control missing');
      await user.click(button);
    };
    await clickIcon('ChevronRightIcon');
    const next: unknown = onChange.mock.calls[0]?.[0];
    expect(dayjs.isDayjs(next) && next.format('YYYY-MM-DD')).toBe('2026-10-25');
    await clickIcon('ChevronLeftIcon');
    const previous: unknown = onChange.mock.calls[1]?.[0];
    expect(dayjs.isDayjs(previous) && previous.format('YYYY-MM-DD')).toBe(
      '2026-10-11',
    );
    const hour = screen.getByText('1 AM').parentElement;
    if (hour === null) throw new Error('Calendar hour missing');
    expect(viewport).toContainElement(hour);
    const initialHeight = parseFloat(getComputedStyle(hour).height);
    await clickIcon('ZoomInIcon');
    expect(parseFloat(getComputedStyle(hour).height)).toBeGreaterThan(
      initialHeight,
    );
    await clickIcon('ZoomOutIcon');
    expect(parseFloat(getComputedStyle(hour).height)).toBe(initialHeight);
    await user.click(screen.getByText('24', { exact: true }));
    const afterZoom: unknown = onSelectDay.mock.calls[1]?.[0];
    expect(dayjs.isDayjs(afterZoom) && afterZoom.isSame(selected)).toBe(true);
  });
});
