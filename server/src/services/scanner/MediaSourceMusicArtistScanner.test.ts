import { faker } from '@faker-js/faker';
import { tag } from '@tunarr/types';
import dayjs from 'dayjs';
import tmp from 'tmp-promise';
import { v4 } from 'uuid';
import { test as baseTest, expect, vi } from 'vitest';
import { bootstrapTunarr } from '../../bootstrap.ts';
import type { GetProgramGroupingById } from '../../commands/GetProgramGroupingById.ts';
import { ProgramGroupingMinter } from '../../db/converters/ProgramGroupingMinter.ts';
import { ProgramDaoMinter } from '../../db/converters/ProgramMinter.ts';
import { DBAccess } from '../../db/DBAccess.ts';
import type { IProgramDB } from '../../db/interfaces/IProgramDB.ts';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import { ProgramDB } from '../../db/ProgramDB.ts';
import { BasicProgramRepository } from '../../db/program/BasicProgramRepository.ts';
import { ProgramExternalIdRepository } from '../../db/program/ProgramExternalIdRepository.ts';
import { ProgramGroupingRepository } from '../../db/program/ProgramGroupingRepository.ts';
import { ProgramGroupingUpsertRepository } from '../../db/program/ProgramGroupingUpsertRepository.ts';
import { ProgramMetadataRepository } from '../../db/program/ProgramMetadataRepository.ts';
import { ProgramSearchRepository } from '../../db/program/ProgramSearchRepository.ts';
import { ProgramStateRepository } from '../../db/program/ProgramStateRepository.ts';
import { ProgramUpsertRepository } from '../../db/program/ProgramUpsertRepository.ts';
import { MediaSourceId, MediaSourceType } from '../../db/schema/base.ts';
import type { NewProgramGroupingWithRelations } from '../../db/schema/derivedTypes.ts';
import {
  MediaSource,
  type MediaSourceOrm,
} from '../../db/schema/MediaSource.ts';
import {
  MediaSourceLibrary,
  type MediaSourceLibraryOrm,
} from '../../db/schema/MediaSourceLibrary.ts';
import { ProgramGroupingType } from '../../db/schema/ProgramGrouping.ts';
import { PlexApiClient } from '../../external/plex/PlexApiClient.ts';
import { globalOptions, setGlobalOptions } from '../../globals.ts';
import { FileSystemService } from '../FileSystemService.ts';
import type { ExternalSubtitleDownloader } from '../../stream/ExternalSubtitleDownloader.ts';
import { copyPreMigratedDb } from '../../testing/testDbFactory.ts';
import type { PlexAlbum, PlexArtist, PlexTrack } from '../../types/Media.ts';
import { Result } from '../../types/result.ts';
import type { MeilisearchService } from '../MeilisearchService.ts';
import { PlexMediaCanonicalizer } from '../PlexMediaCanonicalizers.ts';
import { MediaSourceMusicArtistScanner } from './MediaSourceMusicArtistScanner.ts';
import type { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { ScanContext } from './MediaSourceScanner.ts';

const externalLibraryKey = '11';

// Album metadata shaped like Plex returns it, using the album from issue #2116.
const albumMetadata = {
  ratingKey: '156472',
  key: '/library/metadata/156472/children',
  guid: 'plex://album/5d07c5e4403c640290ac7420',
  librarySectionID: Number(externalLibraryKey),
  parentRatingKey: '156406',
  parentGuid: 'plex://artist/5d07bda1403c640290607447',
  studio: 'Supergiant Games',
  type: 'album',
  title: 'Bastion: Original Soundtrack',
  parentKey: '/library/metadata/156406',
  parentTitle: 'Darren Korb',
  summary: '',
  index: 1,
  year: 2011,
  addedAt: 1675553422,
  updatedAt: 1781767965,
};

type Fixture = {
  drizzle: NonNullable<DBAccess['drizzle']>;
  programDb: IProgramDB;
};

const test = baseTest.extend<Fixture>({
  drizzle: async ({}, use) => {
    const dbResult = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dbResult.path);
    setGlobalOptions({
      database: dbResult.path,
      log_level: 'error',
      verbose: 0,
    });
    await bootstrapTunarr();
    await use(DBAccess.instance.drizzle!);
    await dbResult.cleanup();
  },
  programDb: async ({ drizzle }, use) => {
    const dbAccess = DBAccess.instance;
    const metadataRepo = new ProgramMetadataRepository(
      drizzle,
      new FileSystemService(globalOptions()),
    );
    const externalIdRepo = new ProgramExternalIdRepository(
      dbAccess.db!,
      drizzle,
    );
    await use(
      new ProgramDB(
        new BasicProgramRepository(dbAccess.db!, drizzle),
        new ProgramGroupingRepository(dbAccess.db!, drizzle),
        externalIdRepo,
        new ProgramUpsertRepository(drizzle, externalIdRepo, metadataRepo),
        metadataRepo,
        new ProgramGroupingUpsertRepository(
          dbAccess.db!,
          drizzle,
          metadataRepo,
        ),
        new ProgramSearchRepository(dbAccess.db!, drizzle),
        new ProgramStateRepository(drizzle),
      ),
    );
  },
});

// Exposes the protected album and track scan paths so we can drive them directly.
class TestMusicScanner extends MediaSourceMusicArtistScanner<
  'plex',
  PlexArtist,
  PlexAlbum,
  PlexTrack,
  PlexApiClient
> {
  readonly mediaSourceType = 'plex' as const;

  constructor(
    programDb: IProgramDB,
    programGroupingMinter: ProgramGroupingMinter,
    searchService: MeilisearchService,
    private apiClient: PlexApiClient,
  ) {
    super(
      {} as MediaSourceDB,
      programDb,
      programGroupingMinter,
      new ProgramDaoMinter(),
      searchService,
      {
        scanStarted: vi.fn(),
        scanProgress: vi.fn(),
        scanEnded: vi.fn(),
      } as unknown as MediaSourceProgressService,
      {} as GetProgramGroupingById,
      {} as ExternalSubtitleDownloader,
    );
  }

  protected getApiClient(): Promise<PlexApiClient> {
    return Promise.resolve(this.apiClient);
  }

  protected getLibrarySize(): Promise<number> {
    return Promise.resolve(0);
  }

  protected getSubtitles(): never {
    throw new Error('not implemented for test');
  }

  protected getArtists(): AsyncIterable<PlexArtist> {
    return (async function* () {})();
  }

  protected getAlbums(): AsyncIterable<PlexAlbum> {
    return (async function* () {})();
  }

  /** What Plex lists for each album, by album key: track keys only, like the listing. */
  readonly albumTracks = new Map<string, string[]>();

  protected getAlbumTracks(album: PlexAlbum): AsyncIterable<PlexTrack> {
    const keys = this.albumTracks.get(album.externalId) ?? [];
    return (async function* () {
      for (const externalId of keys) {
        yield { externalId } as unknown as PlexTrack;
      }
    })();
  }

  protected getFullTrackMetadata(): Promise<Result<PlexTrack>> {
    throw new Error('not implemented for test');
  }

  protected getFullArtistMetadata(): Promise<Result<PlexArtist>> {
    throw new Error('not implemented for test');
  }

  protected getEntityExternalKey(item: PlexArtist | PlexAlbum | PlexTrack) {
    return item.externalId;
  }

  updateAlbumForTest(
    album: PlexAlbum,
    artist: PlexArtist,
    scanContext: ScanContext<PlexApiClient>,
  ) {
    return this.updateAlbum(album, artist, undefined, scanContext);
  }

  scanTracksForTest(
    artist: PlexArtist,
    album: PlexAlbum,
    scanContext: ScanContext<PlexApiClient>,
  ) {
    return this.scanTracks(artist, { ...album, artist }, scanContext);
  }
}

async function createTestMediaSourceLibrary(
  drizzle: NonNullable<DBAccess['drizzle']>,
): Promise<{ mediaSource: MediaSourceOrm; library: MediaSourceLibraryOrm }> {
  const mediaSource = {
    uuid: v4() as MediaSourceId,
    name: tag(faker.string.alpha()),
    type: MediaSourceType.Plex,
    createdAt: +dayjs(),
    updatedAt: +dayjs(),
    uri: 'http://localhost:32400',
    accessToken: 'test-token',
    clientIdentifier: null,
    index: 0,
    sendChannelUpdates: false,
    sendGuideUpdates: false,
    username: null,
    userId: null,
    mediaType: null,
  } satisfies MediaSourceOrm;

  await drizzle.insert(MediaSource).values(mediaSource);

  const library = {
    uuid: v4(),
    name: faker.music.genre(),
    mediaSourceId: mediaSource.uuid,
    mediaType: 'tracks' as const,
    lastScannedAt: null,
    externalKey: externalLibraryKey,
    enabled: true,
  } satisfies typeof MediaSourceLibrary.$inferInsert;

  await drizzle.insert(MediaSourceLibrary).values(library);

  return { mediaSource, library };
}

/** A real PlexApiClient whose HTTP layer is stubbed with Plex album metadata. */
function makePlexApiClient(
  mediaSource: MediaSourceOrm,
  library: MediaSourceLibraryOrm,
): PlexApiClient {
  const client = new PlexApiClient(
    {
      getCanonicalId: (item: { ratingKey: string }) =>
        `plex://album/${item.ratingKey}`,
    } as never,
    {
      mediaSource: {
        ...mediaSource,
        libraries: [{ ...library, type: 'tracks' as const }],
      },
    } as never,
  );

  vi.spyOn(client, 'doTypeCheckedGet' as never).mockResolvedValue(
    Result.success({
      MediaContainer: { size: 1, totalSize: 1, Metadata: [albumMetadata] },
    }),
  );

  return client;
}

async function insertArtist(
  programDb: IProgramDB,
  library: MediaSourceLibraryOrm,
  mediaSource: MediaSourceOrm,
): Promise<string> {
  const now = +dayjs();
  const grouping: NewProgramGroupingWithRelations<'artist'> = {
    programGrouping: {
      uuid: v4(),
      canonicalId: 'plex://artist/5d07bda1403c640290607447',
      createdAt: now,
      updatedAt: now,
      title: 'Darren Korb',
      type: ProgramGroupingType.Artist,
      sourceType: 'plex',
      externalKey: '156406',
      mediaSourceId: mediaSource.uuid,
      artistUuid: null,
      showUuid: null,
      libraryId: library.uuid,
      state: 'ok',
    },
    externalIds: [],
    artwork: [],
    credits: [],
    genres: [],
    studios: [],
    tags: [],
  };

  const result = await programDb.upsertProgramGrouping(grouping);
  return result.entity.uuid;
}

function makeArtist(externalId: string, persistedUuid: string): PlexArtist {
  return {
    type: 'artist',
    uuid: persistedUuid,
    externalId,
    canonicalId: 'plex://artist/5d07bda1403c640290607447',
    title: 'Darren Korb',
    sourceType: 'plex',
    identifiers: [],
    artwork: [],
    genres: [],
    tags: [],
  } as unknown as PlexArtist;
}

describe('MediaSourceMusicArtistScanner album/artist association', () => {
  test('an album from a real Plex response is persisted and linked to its artist', async ({
    drizzle,
    programDb,
  }) => {
    const { mediaSource, library } =
      await createTestMediaSourceLibrary(drizzle);
    const persistedArtistUuid = await insertArtist(
      programDb,
      library,
      mediaSource,
    );

    const apiClient = makePlexApiClient(mediaSource, library);
    const searchService = {
      indexMusicAlbum: vi.fn().mockResolvedValue(undefined),
      updatePrograms: vi.fn().mockResolvedValue(undefined),
    } as unknown as MeilisearchService;

    const scanner = new TestMusicScanner(
      programDb,
      new ProgramGroupingMinter(),
      searchService,
      apiClient,
    );

    // The Plex client mints an ephemeral uuid for the nested album.artist that
    // exists in no table; the scanner must not persist it into the artist FK.
    const plexAlbum = await apiClient.getMusicAlbum(albumMetadata.ratingKey);
    expect(plexAlbum.isSuccess()).toBe(true);
    const ephemeralArtistUuid = plexAlbum.get().artist?.uuid;
    expect(ephemeralArtistUuid).toBeDefined();

    const result = await scanner.updateAlbumForTest(
      { externalId: albumMetadata.ratingKey } as unknown as PlexAlbum,
      makeArtist('156406', persistedArtistUuid),
      {
        library,
        mediaSource,
        force: false,
        apiClient,
        scannedEntities: 0,
        totalEntities: 0,
      },
    );

    expect(result.isSuccess()).toBe(true);

    const albumRow = await drizzle.query.programGrouping.findFirst({
      where: (fields, { eq }) => eq(fields.externalKey, '156472'),
    });

    expect(albumRow).toBeDefined();
    expect(albumRow?.type).toBe('album');
    expect(albumRow?.artistUuid).toBe(persistedArtistUuid);
    expect(albumRow?.artistUuid).not.toBe(ephemeralArtistUuid);
  });
});

async function insertAlbum(
  programDb: IProgramDB,
  library: MediaSourceLibraryOrm,
  mediaSource: MediaSourceOrm,
  artistUuid: string,
  externalKey: string,
): Promise<PlexAlbum> {
  const now = +dayjs();
  const grouping: NewProgramGroupingWithRelations<'album'> = {
    programGrouping: {
      uuid: v4(),
      canonicalId: `plex://album/${externalKey}`,
      createdAt: now,
      updatedAt: now,
      title: `Album ${externalKey}`,
      type: ProgramGroupingType.Album,
      sourceType: 'plex',
      externalKey,
      mediaSourceId: mediaSource.uuid,
      artistUuid,
      showUuid: null,
      libraryId: library.uuid,
      state: 'ok',
    },
    externalIds: [],
    artwork: [],
    credits: [],
    genres: [],
    studios: [],
    tags: [],
  };

  const result = await programDb.upsertProgramGrouping(grouping);
  return {
    type: 'album',
    uuid: result.entity.uuid,
    externalId: externalKey,
    title: `Album ${externalKey}`,
  } as unknown as PlexAlbum;
}

// Track metadata shaped like Plex's full /library/metadata/<track> response.
function plexTrackMetadata(
  ratingKey: string,
  albumKey: string,
  updatedAt: number = 1_700_000_000,
) {
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    guid: `plex://track/${ratingKey}`,
    librarySectionID: Number(externalLibraryKey),
    type: 'track' as const,
    title: `Track ${ratingKey}`,
    index: 1,
    duration: 241_000,
    addedAt: 1_700_000_000,
    updatedAt,
    parentRatingKey: albumKey,
    parentTitle: `Album ${albumKey}`,
    parentKey: `/library/metadata/${albumKey}`,
    grandparentRatingKey: '156406',
    grandparentTitle: 'Darren Korb',
    grandparentKey: '/library/metadata/156406',
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
            file: `/media/music/${ratingKey}.flac`,
            size: 30_000_000,
            container: 'flac',
            Stream: [
              {
                id: Number(ratingKey) * 10,
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

/** A real PlexApiClient, with the real canonicalizer, serving each track's full metadata. */
function makeTrackApiClient(
  mediaSource: MediaSourceOrm,
  library: MediaSourceLibraryOrm,
  tracks: Map<string, ReturnType<typeof plexTrackMetadata>>,
): PlexApiClient {
  const client = new PlexApiClient(new PlexMediaCanonicalizer(), {
    mediaSource: {
      ...mediaSource,
      libraries: [{ ...library, type: 'tracks' as const }],
    },
  } as never);

  vi.spyOn(client, 'getItemMetadataInternal' as never).mockImplementation(((
    key: string,
  ) => {
    const metadata = tracks.get(key);
    return Promise.resolve(
      metadata
        ? Result.success(metadata)
        : Result.forError(new Error(`No track ${key}`)),
    );
  }) as never);

  return client;
}

describe('MediaSourceMusicArtistScanner track rescans', () => {
  async function setup(
    drizzle: NonNullable<DBAccess['drizzle']>,
    programDb: IProgramDB,
  ) {
    const { mediaSource, library } =
      await createTestMediaSourceLibrary(drizzle);
    const artistUuid = await insertArtist(programDb, library, mediaSource);
    const artist = makeArtist('156406', artistUuid);
    const tracks = new Map([
      ['301', plexTrackMetadata('301', '300')],
      ['302', plexTrackMetadata('302', '300')],
      ['401', plexTrackMetadata('401', '400')],
    ]);
    const apiClient = makeTrackApiClient(mediaSource, library, tracks);
    const searchService = {
      indexMusicTracks: vi.fn().mockResolvedValue(undefined),
      updatePrograms: vi.fn().mockResolvedValue(undefined),
    } as unknown as MeilisearchService;
    const scanner = new TestMusicScanner(
      programDb,
      new ProgramGroupingMinter(),
      searchService,
      apiClient,
    );
    scanner.albumTracks.set('300', ['301', '302']);
    scanner.albumTracks.set('400', ['401']);

    const albumA = await insertAlbum(
      programDb,
      library,
      mediaSource,
      artistUuid,
      '300',
    );
    const albumB = await insertAlbum(
      programDb,
      library,
      mediaSource,
      artistUuid,
      '400',
    );

    const context: ScanContext<PlexApiClient> = {
      library,
      mediaSource,
      force: false,
      apiClient,
      scannedEntities: 0,
      totalEntities: 0,
    };

    const scan = async (album: PlexAlbum) => {
      const result = await scanner.scanTracksForTest(artist, album, context);
      expect(result.isSuccess()).toBe(true);
    };

    const trackStates = async () => {
      const rows = await drizzle.query.program.findMany({
        where: (fields, { eq }) => eq(fields.libraryId, library.uuid),
        columns: { externalKey: true, state: true },
      });
      return Object.fromEntries(
        rows.map((row) => [row.externalKey, row.state]),
      );
    };

    return { scanner, tracks, albumA, albumB, scan, trackStates };
  }

  test('a rescan only saves tracks that changed', async ({
    drizzle,
    programDb,
  }) => {
    const { tracks, albumA, scan } = await setup(drizzle, programDb);
    const upserts = vi.spyOn(programDb, 'upsertPrograms');

    await scan(albumA);
    expect(upserts).toHaveBeenCalledTimes(2);

    await scan(albumA);
    expect(upserts).toHaveBeenCalledTimes(2);

    // Plex reports an edit to one track
    tracks.set('302', plexTrackMetadata('302', '300', 1_800_000_000));
    await scan(albumA);
    expect(upserts).toHaveBeenCalledTimes(3);
  });

  test('a track Plex no longer lists is marked missing, and recovers when it returns', async ({
    drizzle,
    programDb,
  }) => {
    const { scanner, albumA, albumB, scan, trackStates } = await setup(
      drizzle,
      programDb,
    );

    await scan(albumA);
    await scan(albumB);
    expect(await trackStates()).toEqual({
      '301': 'ok',
      '302': 'ok',
      '401': 'ok',
    });

    // Another album's tracks are not part of this album's scan
    scanner.albumTracks.set('300', ['301']);
    await scan(albumA);
    expect(await trackStates()).toEqual({
      '301': 'ok',
      '302': 'missing',
      '401': 'ok',
    });

    // Unchanged in Plex, but it has to leave the missing state
    scanner.albumTracks.set('300', ['301', '302']);
    await scan(albumA);
    expect(await trackStates()).toEqual({
      '301': 'ok',
      '302': 'ok',
      '401': 'ok',
    });
  });
});
