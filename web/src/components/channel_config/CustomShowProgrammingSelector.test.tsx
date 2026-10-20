import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { describe, expect, test, vi } from 'vitest';
import { CustomShowProgrammingSelector } from './CustomShowProgrammingSelector';

const loadPrograms = vi.hoisted(() => vi.fn<() => Promise<[]>>());
vi.mock('../../hooks/useCustomShows', () => ({
  useCustomShows: () => ({
    data: [
      {
        id: 'show',
        name: 'Evening Shows',
        contentCount: 1,
        totalDuration: 1000,
      },
    ],
  }),
  customShowProgramsQuery: (id: string) => ({
    queryKey: ['show-programs', id],
    queryFn: loadPrograms,
  }),
}));
vi.mock('usehooks-ts', () => ({
  useIntersectionObserver: () => ({ ref: () => {} }),
}));
vi.mock('@/hooks/useProgramTitleFormatter.ts', () => ({
  useProgramTitleFormatter: () => () => '',
}));
vi.mock('./SelectedProgrammingActions.tsx', () => ({ default: () => null }));

describe('custom show previews', () => {
  test('loads only after expansion and preserves the inner loading indicator', async () => {
    let finish: ((programs: []) => void) | undefined;
    loadPrograms.mockReturnValue(
      new Promise<[]>((resolve) => {
        finish = resolve;
      }),
    );
    const { user } = renderWithProviders(
      <CustomShowProgrammingSelector
        toggleOrSetSelectedProgramsDrawer={() => {}}
      />,
    );
    expect(loadPrograms).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await user.click(screen.getByText('Evening Shows'));
    await waitFor(() => expect(loadPrograms).toHaveBeenCalledOnce());
    expect(screen.getByRole('progressbar')).toBeVisible();
    if (finish === undefined) throw new Error('Preview request did not start');
    finish([]);
    await waitFor(() =>
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
    );
  });
});
