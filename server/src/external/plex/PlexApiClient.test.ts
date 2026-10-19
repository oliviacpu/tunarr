import { faker } from '@faker-js/faker';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { QueryError } from '@/external/BaseApiClient.js';
import { Result } from '@/types/result.js';
import { PlexApiClient } from './PlexApiClient.js';

const { fakeLogger } = vi.hoisted(() => {
  const fakeLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => fakeLogger,
  };
  return { fakeLogger };
});

vi.mock('@/util/logging/LoggerFactory.js', () => ({
  LoggerFactory: { child: () => fakeLogger, root: fakeLogger },
}));

vi.mock('@/util/version.js', () => ({
  getTunarrVersion: () => '1.0.0-test',
}));

function plexHttpError(status: number) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    config,
    {},
    { status, statusText: '', data: undefined, headers: {}, config },
  );
}

function makeMinimalPlexClient() {
  const mediaSourceId = faker.string.uuid();
  const libraryId = faker.string.uuid();
  const externalLibraryKey = '1';

  const canonicalizer = {
    getCanonicalId: (item: { ratingKey: string }) =>
      `plex://movie/${item.ratingKey}`,
  };

  const client = new PlexApiClient(canonicalizer as never, {
    mediaSource: {
      uuid: mediaSourceId,
      name: 'Test Plex' as never,
      type: 'plex',
      uri: 'http://localhost:32400',
      accessToken: 'test-token',
      libraries: [
        {
          uuid: libraryId,
          externalKey: externalLibraryKey,
          name: 'Movies',
          type: 'movies',
          mediaSourceId,
        } as never,
      ],
    },
  });

  return { client, mediaSourceId, libraryId, externalLibraryKey };
}

function makePlexMovieMetadata(ratingKey: string, librarySectionID: number) {
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    guid: `plex://movie/${ratingKey}`,
    Guid: [{ id: `imdb://tt${ratingKey}` }],
    librarySectionID,
    type: 'movie' as const,
    title: `Movie ${ratingKey}`,
    duration: faker.number.int({ min: 3_600_000, max: 7_200_000 }),
    year: 2024,
    addedAt: Date.now(),
    studio: 'Test Studio',
    Media: [
      {
        id: Number(ratingKey),
        duration: 7_200_000,
        bitrate: 8000,
        width: 1920,
        height: 1080,
        videoResolution: '1080',
        container: 'mkv',
        videoCodec: 'h264',
        audioCodec: 'aac',
        Part: [
          {
            id: Number(ratingKey),
            key: `/library/parts/${ratingKey}/file.mkv`,
            duration: 7_200_000,
            file: `/media/movies/movie_${ratingKey}.mkv`,
            size: 1_000_000_000,
            container: 'mkv',
          },
        ],
      },
    ],
  };
}

function makePlexTrackMetadata(ratingKey: string, librarySectionID: number) {
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    guid: `plex://track/${ratingKey}`,
    librarySectionID,
    type: 'track' as const,
    title: `Track ${ratingKey}`,
    index: 3,
    duration: 241_000,
    addedAt: Date.now(),
    parentRatingKey: '200',
    parentTitle: 'Album',
    parentKey: '/library/metadata/200',
    grandparentRatingKey: '100',
    grandparentTitle: 'Artist',
    grandparentKey: '/library/metadata/100',
    Media: [
      {
        id: Number(ratingKey),
        duration: 241_000,
        bitrate: 900,
        audioChannels: 2,
        audioCodec: 'flac',
        container: 'flac',
        Part: [
          {
            id: Number(ratingKey),
            key: `/library/parts/${ratingKey}/file.flac`,
            duration: 241_000,
            file: `/media/music/Artist/Album/03 Track.flac`,
            size: 30_000_000,
            container: 'flac',
            Stream: [
              {
                id: 1,
                streamType: 2,
                index: 0,
                codec: 'flac',
                channels: 2,
                selected: true,
                displayTitle: 'FLAC (Stereo)',
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Serves `allMetadata` the way a Plex server does: honoring
 * X-Plex-Container-Start/Size and returning an empty container once the
 * listing is exhausted. Set `reportTotalSize: false` to model a server that
 * omits totalSize.
 */
function mockPagedItems(
  client: PlexApiClient,
  allMetadata: unknown[],
  { reportTotalSize = true }: { reportTotalSize?: boolean } = {},
) {
  return vi
    .spyOn(client, 'doTypeCheckedGet' as never)
    .mockImplementation(
      (
        _path: string,
        _schema: unknown,
        config: { params: Record<string, unknown> },
      ) => {
        const offset = (config.params['X-Plex-Container-Start'] as number) ?? 0;
        const size = (config.params['X-Plex-Container-Size'] as number) ?? 50;
        const page = allMetadata.slice(offset, offset + size);
        return Promise.resolve(
          Result.success({
            MediaContainer: {
              size: page.length,
              ...(reportTotalSize ? { totalSize: allMetadata.length } : {}),
              Metadata: page,
            },
          }),
        );
      },
    );
}

describe('PlexApiClient', () => {
  describe('getMusicTrack', () => {
    it("keeps an audio-only track's audio stream", async () => {
      // Tracks have no video stream. The media-stream import used to require one, so every track fell back to an
      // item with no streams and could not be played.
      const { client, externalLibraryKey } = makeMinimalPlexClient();
      vi.spyOn(client, 'getItemMetadataInternal' as never).mockResolvedValue(
        Result.success(
          makePlexTrackMetadata('300', Number(externalLibraryKey)),
        ) as never,
      );

      const result = await client.getMusicTrack('300');

      expect(result.isSuccess()).toBe(true);
      const streams = result.get().mediaItem?.streams ?? [];
      expect(streams).toHaveLength(1);
      expect(streams[0]).toMatchObject({
        streamType: 'audio',
        codec: 'flac',
        channels: 2,
        index: 0,
      });
    });
  });

  describe('getArtistAlbums', () => {
    it("lists an artist's EPs and singles through the library section", async () => {
      // Plex's /library/metadata/<artist>/children only returns full albums, so EPs and singles were never
      // scanned. Artists with nothing else were imported with no albums at all.
      const { client, externalLibraryKey } = makeMinimalPlexClient();
      const librarySectionID = Number(externalLibraryKey);
      const release = (ratingKey: string, title: string) => ({
        ratingKey,
        key: `/library/metadata/${ratingKey}/children`,
        guid: `plex://album/${ratingKey}`,
        librarySectionID,
        type: 'album' as const,
        title,
        parentRatingKey: '100',
        parentTitle: 'Artist',
      });
      const doGetSpy = mockPagedItems(client, [
        release('201', 'An Album'),
        release('202', 'An EP'),
        release('203', 'A Single'),
      ]);

      const albums = await Array.fromAsync(
        client.getArtistAlbums('100', 50, externalLibraryKey),
      );

      expect(albums.map((album) => album.title)).toEqual([
        'An Album',
        'An EP',
        'A Single',
      ]);
      expect(doGetSpy).toHaveBeenCalledWith(
        `/library/sections/${externalLibraryKey}/all?type=9&artist.id=100`,
        expect.anything(),
        expect.anything(),
      );
      expect(doGetSpy).not.toHaveBeenCalledWith(
        '/library/metadata/100/children',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('getItemChildren', () => {
    it('pages exactly to totalSize when the server reports it', async () => {
      const { client, externalLibraryKey } = makeMinimalPlexClient();

      const librarySectionID = Number(externalLibraryKey);

      // 120 items across three pages of 50.
      const allMetadata = Array.from({ length: 120 }, (_, i) =>
        makePlexMovieMetadata(String(i + 1), librarySectionID),
      );

      const doGetSpy = mockPagedItems(client, allMetadata);

      const result = await client.getItemChildren('playlist-1', 'playlist');

      expect(result.isSuccess()).toBe(true);
      const items = result.get();
      expect(items).toHaveLength(120);

      // 0-49, 50-99, 100-119. totalSize tells us we are done, so no extra
      // request is spent discovering the end of the listing.
      expect(doGetSpy).toHaveBeenCalledTimes(3);
      expect(doGetSpy).toHaveBeenCalledWith(
        '/playlists/playlist-1/items',
        expect.anything(),
        expect.objectContaining({
          params: expect.objectContaining({
            'X-Plex-Container-Start': 0,
            'X-Plex-Container-Size': 50,
          }),
        }),
      );
      expect(doGetSpy).toHaveBeenCalledWith(
        '/playlists/playlist-1/items',
        expect.anything(),
        expect.objectContaining({
          params: expect.objectContaining({
            'X-Plex-Container-Start': 50,
            'X-Plex-Container-Size': 50,
          }),
        }),
      );
      expect(doGetSpy).toHaveBeenCalledWith(
        '/playlists/playlist-1/items',
        expect.anything(),
        expect.objectContaining({
          params: expect.objectContaining({
            'X-Plex-Container-Start': 100,
            'X-Plex-Container-Size': 50,
          }),
        }),
      );
    });

    it('pages until an empty page when the server omits totalSize', async () => {
      const { client, externalLibraryKey } = makeMinimalPlexClient();

      const librarySectionID = Number(externalLibraryKey);
      const allMetadata = Array.from({ length: 120 }, (_, i) =>
        makePlexMovieMetadata(String(i + 1), librarySectionID),
      );

      const doGetSpy = mockPagedItems(client, allMetadata, {
        reportTotalSize: false,
      });

      const result = await client.getItemChildren('playlist-1a', 'playlist');

      // Falling back to the container's `size` here would report a total of 50
      // and stop after the first page.
      expect(result.isSuccess()).toBe(true);
      expect(result.get()).toHaveLength(120);
      // 0-49, 50-99, 100-119, then the empty page at 120 that ends the loop
      expect(doGetSpy).toHaveBeenCalledTimes(4);
      expect(doGetSpy).toHaveBeenCalledWith(
        '/playlists/playlist-1a/items',
        expect.anything(),
        expect.objectContaining({
          params: expect.objectContaining({
            'X-Plex-Container-Start': 120,
            'X-Plex-Container-Size': 50,
          }),
        }),
      );
    });

    it('advances by the returned count when the server serves short pages', async () => {
      const { client, externalLibraryKey } = makeMinimalPlexClient();

      const librarySectionID = Number(externalLibraryKey);
      const allMetadata = Array.from({ length: 45 }, (_, i) =>
        makePlexMovieMetadata(String(i + 1), librarySectionID),
      );

      // A server that caps pages at 20 regardless of X-Plex-Container-Size.
      const doGetSpy = vi
        .spyOn(client, 'doTypeCheckedGet' as never)
        .mockImplementation(
          (
            _path: string,
            _schema: unknown,
            config: { params: Record<string, unknown> },
          ) => {
            const offset =
              (config.params['X-Plex-Container-Start'] as number) ?? 0;
            const page = allMetadata.slice(offset, offset + 20);
            return Promise.resolve(
              Result.success({
                MediaContainer: {
                  size: page.length,
                  totalSize: allMetadata.length,
                  Metadata: page,
                },
              }),
            );
          },
        );

      const result = await client.getItemChildren('playlist-2', 'playlist');

      // Advancing by the requested 50 rather than the returned 20 would have
      // skipped items 21-45 entirely.
      expect(result.isSuccess()).toBe(true);
      expect(result.get()).toHaveLength(45);
      // 0, 20, 40 — totalSize is reached exactly despite the short pages
      expect(doGetSpy).toHaveBeenCalledTimes(3);
    });

    it('fails rather than truncating when a mid-pagination request fails', async () => {
      const { client, externalLibraryKey } = makeMinimalPlexClient();

      const librarySectionID = Number(externalLibraryKey);
      const firstPage = Array.from({ length: 50 }, (_, i) =>
        makePlexMovieMetadata(String(i + 1), librarySectionID),
      );

      vi.spyOn(client, 'doTypeCheckedGet' as never)
        .mockImplementationOnce(() =>
          Promise.resolve(
            Result.success({
              MediaContainer: {
                size: 50,
                totalSize: 150,
                Metadata: firstPage,
              },
            }),
          ),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(Result.forError(new Error('network timeout'))),
        );

      const result = await client.getItemChildren('playlist-3', 'playlist');

      // A truncated listing is indistinguishable from a genuinely short one,
      // and callers overwrite their contents with it. Fail instead.
      expect(result.isFailure()).toBe(true);
      expect(fakeLogger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('failing rather than returning a truncated'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('returns an error when the first request fails', async () => {
      const { client } = makeMinimalPlexClient();

      vi.spyOn(client, 'doTypeCheckedGet' as never).mockImplementation(() =>
        Promise.resolve(Result.forError(new Error('connection refused'))),
      );

      const result = await client.getItemChildren('playlist-4', 'playlist');

      expect(result.isFailure()).toBe(true);
    });

    it('drops items with unmatched librarySectionID and logs debug message', async () => {
      const { client, externalLibraryKey } = makeMinimalPlexClient();

      const matchedLibrary = Number(externalLibraryKey); // library "1" exists
      const unmatchedLibrary = 99; // library "99" does NOT exist

      const metadata = [
        makePlexMovieMetadata('1', matchedLibrary),
        makePlexMovieMetadata('2', unmatchedLibrary),
        makePlexMovieMetadata('3', matchedLibrary),
      ];

      mockPagedItems(client, metadata);

      const result = await client.getItemChildren('playlist-5', 'playlist');

      expect(result.isSuccess()).toBe(true);
      // Only 2 of 3 items match the synced library
      expect(result.get()).toHaveLength(2);
      // Debug log for the dropped item
      expect(fakeLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('no matching library'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('drops an item type Tunarr does not model without rejecting its page', async () => {
      const { client, externalLibraryKey } = makeMinimalPlexClient();

      const librarySectionID = Number(externalLibraryKey);
      const metadata = [
        makePlexMovieMetadata('1', librarySectionID),
        // Plex playlists can hold extras/clips, which are not in the
        // PlexMediaNoCollectionPlaylist discriminated union.
        { ratingKey: '2', type: 'clip', title: 'Some Extra', librarySectionID },
        makePlexMovieMetadata('3', librarySectionID),
      ];

      mockPagedItems(client, metadata);

      const result = await client.getItemChildren('playlist-6', 'playlist');

      expect(result.isSuccess()).toBe(true);
      expect(result.get()).toHaveLength(2);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dropping unsupported Plex item'),
        expect.anything(),
        '2',
        'clip',
        'Some Extra',
        expect.anything(),
      );
    });

    it('keeps paginating past a page containing an unmodeled item', async () => {
      const { client, externalLibraryKey } = makeMinimalPlexClient();

      const librarySectionID = Number(externalLibraryKey);
      const allMetadata: unknown[] = Array.from({ length: 120 }, (_, i) =>
        makePlexMovieMetadata(String(i + 1), librarySectionID),
      );
      // Put the unmodeled item on the third page. Before this fix the whole
      // page failed validation and pagination stopped, yielding 100/120 items.
      allMetadata[100] = {
        ratingKey: '101',
        type: 'clip',
        title: 'Behind the Scenes',
        librarySectionID,
      };

      mockPagedItems(client, allMetadata);

      const result = await client.getItemChildren('playlist-7', 'playlist');

      expect(result.isSuccess()).toBe(true);
      // Only the single unmodeled item is lost, not the rest of its page nor
      // the pages after it.
      expect(result.get()).toHaveLength(119);
    });

    it('stops paginating when the server ignores X-Plex-Container-Start', async () => {
      const { client, externalLibraryKey } = makeMinimalPlexClient();

      const librarySectionID = Number(externalLibraryKey);
      const metadata = [makePlexMovieMetadata('1', librarySectionID)];

      // Never returns an empty page, so only the page cap ends the loop.
      const doGetSpy = vi
        .spyOn(client, 'doTypeCheckedGet' as never)
        .mockImplementation(() =>
          Promise.resolve(
            Result.success({
              MediaContainer: { size: 1, Metadata: metadata },
            }),
          ),
        );

      const result = await client.getItemChildren('playlist-8', 'playlist');

      expect(result.isSuccess()).toBe(true);
      expect(doGetSpy).toHaveBeenCalledTimes(1_000);
      expect(fakeLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Stopped paginating'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('getDvrs', () => {
    it('rejects when the lookup failed, so a caller can retry', async () => {
      // A 503 or a timeout used to come back as an empty list, indistinguishable from a Plex with no DVR, and
      // the guide notifier gave up on its first try instead of asking again.
      const { client } = makeMinimalPlexClient();
      vi.spyOn(client, 'doGetResult' as never).mockResolvedValue(
        Result.failure(
          QueryError.genericQueryError('503 Maintenance'),
        ) as never,
      );

      await expect(client.getDvrs()).rejects.toMatchObject({
        type: 'generic_request_error',
      });
    });

    it.each([401, 403])(
      'rejects a refused token (%i) as an auth error, which a caller does not retry',
      async (status) => {
        // It came back as a generic failure, so the guide notifier retried a token that can't work.
        const { client } = makeMinimalPlexClient();
        vi.spyOn(client, 'doRequest' as never).mockRejectedValue(
          plexHttpError(status) as never,
        );
        fakeLogger.error.mockClear();

        await expect(client.getDvrs()).rejects.toMatchObject({
          type: 'auth_error',
        });
        // The caller reports it, with the server's name: no error line of its own.
        expect(fakeLogger.error).not.toHaveBeenCalled();
      },
    );

    it('answers no DVRs for a Plex without Live TV', async () => {
      const { client } = makeMinimalPlexClient();
      vi.spyOn(client, 'doGetResult' as never).mockResolvedValue(
        Result.failure(QueryError.create('not_found', 'Not found')) as never,
      );

      await expect(client.getDvrs()).resolves.toEqual([]);
    });

    it('lists the DVRs Plex answers with', async () => {
      const { client } = makeMinimalPlexClient();
      vi.spyOn(client, 'doGetResult' as never).mockResolvedValue(
        Result.success({ size: 1, Dvr: [{ key: '4' }] }) as never,
      );

      await expect(client.getDvrs()).resolves.toEqual([{ key: '4' }]);
    });
  });

  describe('refreshGuide', () => {
    it.each([
      [401, 'auth_error'],
      [403, 'auth_error'],
      [503, 'generic_request_error'],
    ])(
      'rejects a failed reload (%i) with a classified %s, like getDvrs',
      async (status, type) => {
        // It rejected with the raw AxiosError, so the guide notifier had to repeat the 401/403 rule.
        const { client } = makeMinimalPlexClient();
        vi.spyOn(client, 'doRequest' as never).mockRejectedValue(
          plexHttpError(status) as never,
        );

        await expect(
          client.refreshGuide([{ key: '4' }] as never),
        ).rejects.toMatchObject({ type });
      },
    );
  });
});
