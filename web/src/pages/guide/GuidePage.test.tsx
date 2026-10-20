import { act, renderWithProviders, screen, within } from '@/test/utils';
import type { Dayjs } from 'dayjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import useStore from '../../store/index.ts';
import { setGuideDurationState } from '../../store/themeEditor/actions.ts';
import GuidePage from './GuidePage.tsx';

vi.mock('@mui/x-date-pickers', () => ({
  DateTimePicker: () => null,
}));

vi.mock('../../components/guide/TvGuide.tsx', () => ({
  TvGuide: ({ start, end }: { start: Dayjs; end: Dayjs }) => (
    <output aria-label="Rendered guide hours">{end.diff(start, 'hour')}</output>
  ),
}));

vi.mock('../../components/channel_config/NoChannelsCreated.tsx', () => ({
  default: () => null,
}));

const savedDuration = useStore.getState().theme.guideDuration;

describe('Guide duration controls', () => {
  beforeEach(() => setGuideDurationState(3 * 60 * 60 * 1000));
  afterEach(() => {
    act(() => setGuideDurationState(savedDuration));
  });

  test('minus decreases three hours and stops at one hour', async () => {
    const { user } = renderWithProviders(<GuidePage channelId="all" />);
    const group = screen.getByRole('group', { name: 'Guide duration' });
    const minus = within(group).getByRole('button', {
      name: 'Show one hour less',
    });
    const plus = within(group).getByRole('button', {
      name: 'Show one hour more',
    });
    const duration = within(group).getByText('3 hours');

    expect(duration.previousElementSibling).toBe(minus);
    expect(within(minus).getByTestId('ZoomOutIcon')).toBeInTheDocument();
    expect(duration.nextElementSibling).toBe(plus);
    expect(within(plus).getByTestId('ZoomInIcon')).toBeInTheDocument();
    await user.click(minus);
    expect(within(group).getByText('2 hours')).toBeInTheDocument();
    expect(screen.getByLabelText('Rendered guide hours')).toHaveTextContent(
      '2',
    );
    await user.click(minus);
    expect(within(group).getByText('an hour')).toBeInTheDocument();
    expect(minus).toBeDisabled();
    expect(screen.getByLabelText('Rendered guide hours')).toHaveTextContent(
      '1',
    );
    expect(useStore.getState().theme.guideDuration).toBe(60 * 60 * 1000);
    expect(plus).toBeEnabled();
  });

  test('plus increases three hours to eight and enables increasing again after minus', async () => {
    const { user } = renderWithProviders(<GuidePage channelId="all" />);
    const plus = screen.getByRole('button', { name: 'Show one hour more' });

    for (let hours = 4; hours <= 8; hours++) {
      await user.click(plus);
      expect(screen.getByText(`${hours} hours`)).toBeInTheDocument();
      expect(screen.getByLabelText('Rendered guide hours')).toHaveTextContent(
        `${hours}`,
      );
    }

    expect(plus).toBeDisabled();
    expect(useStore.getState().theme.guideDuration).toBe(8 * 60 * 60 * 1000);
    await user.click(
      screen.getByRole('button', { name: 'Show one hour less' }),
    );
    expect(screen.getByText('7 hours')).toBeInTheDocument();
    expect(plus).toBeEnabled();
  });
});
