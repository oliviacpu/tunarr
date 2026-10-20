import { renderWithProviders, screen } from '@/test/utils';
import type { MediaSourceLibrary, MediaSourceSettings } from '@tunarr/types';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EditMediaSourceLibrariesDialog } from './EditMediaSourceLibrariesDialog.tsx';

const { updateLibrary, scanLibrary } = vi.hoisted(() => ({
  updateLibrary: vi.fn(),
  scanLibrary: vi.fn(),
}));

const library: MediaSourceLibrary = {
  id: 'library-1',
  name: 'Movies',
  mediaType: 'movies',
  externalKey: 'movies',
  type: 'local',
  enabled: true,
  isLocked: false,
};
const mediaSource: MediaSourceSettings = {
  id: 'source-1',
  name: 'Local movies',
  type: 'local',
  mediaType: 'movies',
  paths: ['/media/movies'],
  libraries: [library],
  pathReplacements: [],
};

vi.mock('../../../hooks/media-sources/useMediaSourceLibraries.ts', () => ({
  useMediaSourceLibraries: () => ({ data: [library] }),
}));
vi.mock('../../../hooks/media-sources/mediaSourceLibraryHooks.ts', () => ({
  useUpdateLibraryMutation: () => ({ mutate: updateLibrary }),
  useScanLibraryMutation: () => ({ mutate: scanLibrary }),
}));

describe('EditMediaSourceLibrariesDialog actions', () => {
  beforeEach(() => {
    updateLibrary.mockClear();
    scanLibrary.mockClear();
  });

  test('saves toggles immediately and uses an outlined Close only to dismiss', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <EditMediaSourceLibrariesDialog
        mediaSource={mediaSource}
        open
        onClose={onClose}
      />,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveClass('MuiButton-outlined');
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));
    expect(updateLibrary).toHaveBeenCalledExactlyOnceWith({
      path: { id: 'source-1', libraryId: 'library-1' },
      body: { enabled: false },
    });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(close);
    expect(onClose).toHaveBeenCalledOnce();
    expect(updateLibrary).toHaveBeenCalledOnce();
    expect(scanLibrary).not.toHaveBeenCalled();
  });

  test('closing without a change does not write or scan a library', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <EditMediaSourceLibrariesDialog
        mediaSource={mediaSource}
        open
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(updateLibrary).not.toHaveBeenCalled();
    expect(scanLibrary).not.toHaveBeenCalled();
  });
});
