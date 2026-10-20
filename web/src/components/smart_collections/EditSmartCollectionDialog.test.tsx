import { act, renderWithProviders, screen, waitFor } from '@/test/utils';
import { Dialog } from '@mui/material';
import { QueryClient } from '@tanstack/react-query';
import type { SmartCollection } from '@tunarr/types';
import { search } from '@tunarr/shared/util';
import { SnackbarProvider } from 'notistack';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import { EditSmartCollectionDialog } from './EditSmartCollectionDialog.tsx';

const { saved, update } = vi.hoisted(() => ({
  saved: { collection: null as SmartCollection | null },
  update:
    vi.fn<
      (options: {
        path: { id: string };
        body: Partial<SmartCollection>;
      }) => Promise<{ data: SmartCollection }>
    >(),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiSmartCollectionsById: () => Promise.resolve({ data: saved.collection }),
  putApiSmartCollectionsById: (options: {
    path: { id: string };
    body: Partial<SmartCollection>;
  }) => update(options),
}));

const id = '11111111-1111-4111-8111-111111111111';
const initial: SmartCollection = {
  uuid: id,
  name: 'Movie night',
  keywords: 'space',
  filterString: 'type:movie',
  filter: {
    type: 'value',
    fieldSpec: {
      key: 'type',
      type: 'faceted_string',
      op: '=',
      value: ['movie'],
    },
  },
};

function renderEditor(queryClient?: QueryClient) {
  const onClose = vi.fn();
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <Dialog open>
        <EditSmartCollectionDialog id={id} onClose={onClose} />
      </Dialog>
    </SnackbarProvider>,
    { queryClient },
  );
  return { ...rendered, onClose };
}

describe('EditSmartCollectionDialog', () => {
  beforeEach(() => {
    saved.collection = structuredClone(initial);
    update.mockReset();
    update.mockImplementation(async (options) => {
      saved.collection = { ...initial, ...options.body };
      return { data: saved.collection };
    });
  });

  test('loads the stored query and saves name, keywords and parsed filter together', async () => {
    const { user, onClose } = renderEditor();
    const keywords = await screen.findByLabelText('Keywords');
    expect(keywords).toHaveValue('space');
    expect(screen.getByLabelText('Filter')).toHaveValue('type:movie');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Series night');
    await user.clear(keywords);
    await user.type(keywords, 'science');
    await user.clear(screen.getByLabelText('Filter'));
    await user.type(screen.getByLabelText('Filter'), 'type:episode');
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const request = update.mock.calls[0]?.[0];
    expect(request?.path.id).toBe(id);
    expect(request?.body).toMatchObject({
      name: 'Series night',
      keywords: 'science',
    });
    expect(
      request?.body.filter && search.searchFilterToString(request.body.filter),
    ).toBe('type = "episode"');
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  test('blocks an invalid expression and can explicitly clear a stored filter', async () => {
    const { user } = renderEditor();
    const filter = await screen.findByLabelText('Filter');
    await user.clear(filter);
    await user.type(filter, '(');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
    );
    expect(
      screen.getByText(/Could not parse this filter expression/),
    ).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    await user.clear(filter);
    await user.clear(screen.getByLabelText('Keywords'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]?.[0].body).toEqual({
      name: initial.name,
      keywords: '',
      filter: { type: 'op', op: 'and', children: [] },
    });
  });

  test('keeps unsaved query edits when the collection refetches', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { user } = renderEditor(client);
    const keywords = await screen.findByLabelText('Keywords');
    await user.clear(keywords);
    await user.type(keywords, 'unsaved query');
    saved.collection = { ...initial, name: 'Server name' };
    await act(async () => {
      await client.refetchQueries();
    });
    expect(keywords).toHaveValue('unsaved query');
    expect(screen.getByLabelText('Name')).toHaveValue(initial.name);
    client.clear();
  });
});
