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

describe('Guide zoom controls', () => {
  beforeEach(() => setGuideDurationState(3 * 60 * 60 * 1000));
  afterEach(() => {
    act(() => setGuideDurationState(savedDuration));
  });

  test('flanks the duration with zoom controls and stops at one hour', async () => {
    const { user } = renderWithProviders(<GuidePage channelId="all" />);
    const group = screen.getByRole('group', { name: 'Guide zoom' });
    const zoomIn = within(group).getByRole('button', { name: 'Zoom in' });
    const zoomOut = within(group).getByRole('button', { name: 'Zoom out' });
    const duration = within(group).getByText('3 hours');

    expect(duration.previousElementSibling).toBe(zoomOut);
    expect(duration.nextElementSibling).toBe(zoomIn);
    await user.click(zoomIn);
    expect(within(group).getByText('2 hours')).toBeInTheDocument();
    expect(screen.getByLabelText('Rendered guide hours')).toHaveTextContent(
      '2',
    );
    await user.click(zoomIn);
    expect(within(group).getByText('an hour')).toBeInTheDocument();
    expect(zoomIn).toBeDisabled();
    expect(screen.getByLabelText('Rendered guide hours')).toHaveTextContent(
      '1',
    );
    expect(useStore.getState().theme.guideDuration).toBe(60 * 60 * 1000);
  });

  test('zooms out to eight hours and enables zooming back in', async () => {
    const { user } = renderWithProviders(<GuidePage channelId="all" />);
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });

    for (let hours = 4; hours <= 8; hours++) {
      await user.click(zoomOut);
      expect(screen.getByText(`${hours} hours`)).toBeInTheDocument();
      expect(screen.getByLabelText('Rendered guide hours')).toHaveTextContent(
        `${hours}`,
      );
    }

    expect(zoomOut).toBeDisabled();
    expect(useStore.getState().theme.guideDuration).toBe(8 * 60 * 60 * 1000);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('7 hours')).toBeInTheDocument();
    expect(zoomOut).toBeEnabled();
  });
});
