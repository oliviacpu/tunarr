import type { LibraryUsedBy } from '@tunarr/types/api';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import type * as Sdk from '../generated/sdk.gen.ts';
import { useLibraryUsage } from '../hooks/useLibraryUsage.ts';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog.tsx';
import { LibraryUsageDetails, UsedByChip } from './LibraryUsage.tsx';

const { fetchUsage } = vi.hoisted(() => ({
  fetchUsage: vi.fn<() => Promise<{ data: LibraryUsedBy }>>(),
}));
vi.mock('../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiFillerListsUsedBy: fetchUsage,
}));

function UsageDialog() {
  const usage = useLibraryUsage('fillerLists');
  const [open, setOpen] = useState(false);
  return (
    <>
      <UsedByChip id="list" usage={usage} />
      <button onClick={() => setOpen(true)}>Open delete</button>
      <DeleteConfirmationDialog
        open={open}
        title="Delete Shorts?"
        onClose={() => setOpen(false)}
        onConfirm={() => {}}
        details={
          <LibraryUsageDetails
            kind="fillerLists"
            open={open}
            items={[{ id: 'list', name: 'Shorts' }]}
          />
        }
      />
    </>
  );
}

beforeEach(() => fetchUsage.mockReset());

test.each([false, true])(
  'refreshes cached table usage before displaying a delete warning (previously referenced: %s)',
  async (referenced) => {
    const cached: LibraryUsedBy = referenced
      ? { list: [{ id: 'old', name: 'Old channel', number: 1, slots: [] }] }
      : {};
    let resolve: (data: { data: LibraryUsedBy }) => void = () => {
      throw new Error('The deferred refetch was not initialized');
    };
    const fresh = new Promise<{ data: LibraryUsedBy }>((done) => {
      resolve = done;
    });
    fetchUsage.mockResolvedValueOnce({ data: cached }).mockReturnValue(fresh);
    const { user } = renderWithProviders(<UsageDialog />);
    await screen.findByText(
      referenced ? 'Used by 1 channel' : 'Used by 0 channels',
    );
    await user.click(screen.getByRole('button', { name: 'Open delete' }));
    await waitFor(() => expect(fetchUsage).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loading channel references…')).toBeInTheDocument();
    expect(
      screen.queryByText('No channels reference these items.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('1 · Old channel')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete' }),
    ).toBeEnabled();
    resolve({
      data: {
        list: [{ id: 'fresh', name: 'Fresh channel', number: 7, slots: [2] }],
      },
    });
    expect(
      await screen.findByText('7 · Fresh channel (slots 2)'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Loading channel references…'),
    ).not.toBeInTheDocument();
  },
);
