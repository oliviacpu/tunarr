import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/utils';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';
import { LibraryUsageDetails, UsedByChip } from './LibraryUsage';

const usage = vi.hoisted(() => ({
  data: {} as Record<
    string,
    { id: string; name: string; number: number; slots: number[] }[]
  >,
  isPending: false,
  isError: false,
}));
vi.mock('../hooks/useLibraryUsage.ts', () => ({
  useLibraryUsage: () => usage,
}));

beforeEach(() => {
  usage.data = {};
  usage.isPending = false;
  usage.isError = false;
});

describe('library usage', () => {
  test('shows unique channel count and names with slot positions', async () => {
    usage.data = {
      list: [
        { id: 'one', name: 'Evening Movies', number: 7, slots: [1, 3] },
        { id: 'two', name: 'Cartoons', number: 12, slots: [] },
      ],
    };
    const { user } = renderWithProviders(
      <UsedByChip id="list" usage={usage} />,
    );
    const chip = screen.getByText('Used by 2 channels');
    await user.hover(chip);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      '7 · Evening Movies (slots 1, 3)',
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('12 · Cartoons');
  });

  test.each([
    { isPending: true, isError: false, label: 'Loading usage…' },
    { isPending: false, isError: true, label: 'Usage unavailable' },
    { isPending: false, isError: false, label: 'Used by 0 channels' },
  ])('distinguishes $label from an unused item', (state) => {
    renderWithProviders(
      <UsedByChip id="list" usage={{ ...usage, ...state }} />,
    );
    expect(screen.getByText(state.label)).toBeInTheDocument();
  });

  test('names each selected entity and its affected channels in a bulk warning', () => {
    usage.data = {
      first: [{ id: 'one', name: 'Evening Movies', number: 7, slots: [2] }],
      second: [{ id: 'two', name: 'Cartoons', number: 12, slots: [] }],
    };
    renderWithProviders(
      <LibraryUsageDetails
        kind="fillerLists"
        open
        items={[
          { id: 'first', name: 'Shorts' },
          { id: 'second', name: 'Promos' },
        ]}
      />,
    );
    expect(screen.getByText('Shorts')).toBeInTheDocument();
    expect(screen.getByText('Promos')).toBeInTheDocument();
    expect(
      screen.getByText('7 · Evening Movies (slots 2)'),
    ).toBeInTheDocument();
    expect(screen.getByText('12 · Cartoons')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  test.each(['loading', 'error', 'referenced'] as const)(
    'does not block deletion when references are %s',
    async (state) => {
      usage.isPending = state === 'loading';
      usage.isError = state === 'error';
      usage.data = {
        list: [{ id: 'one', name: 'Evening Movies', number: 7, slots: [1] }],
      };
      const remove = vi.fn();
      const { user } = renderWithProviders(
        <DeleteConfirmationDialog
          open
          title="Delete Shorts?"
          onConfirm={remove}
          onClose={() => {}}
          details={
            <LibraryUsageDetails
              kind="fillerLists"
              open
              items={[{ id: 'list', name: 'Shorts' }]}
            />
          }
        />,
      );
      if (state === 'loading')
        expect(
          screen.getByText('Loading channel references…'),
        ).toBeInTheDocument();
      if (state === 'error')
        expect(
          screen.getByText('Channel references could not be loaded.'),
        ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(remove).toHaveBeenCalledOnce();
    },
  );
});
