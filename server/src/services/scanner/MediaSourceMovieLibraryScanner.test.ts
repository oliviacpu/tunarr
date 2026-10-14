import { describe, expect, test, vi } from 'vitest';
import type { ProgramConverter } from '../../db/converters/ProgramConverter.ts';
import type { ProgramDaoMinter } from '../../db/converters/ProgramMinter.ts';
import type {
  IProgramDB,
  ProgramCanonicalIdLookupResult,
} from '../../db/interfaces/IProgramDB.ts';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { MediaSourceOrm } from '../../db/schema/MediaSource.ts';
import type { MediaSourceLibrary } from '../../db/schema/MediaSourceLibrary.ts';
import type { MediaSourceApiClient } from '../../external/MediaSourceApiClient.ts';
import type { ExternalSubtitleDownloader } from '../../stream/ExternalSubtitleDownloader.ts';
import type { HasMediaSourceInfo, Movie } from '../../types/Media.ts';
import { Result } from '../../types/result.ts';
import type { MeilisearchService } from '../MeilisearchService.ts';
import { MediaSourceMovieLibraryScanner } from './MediaSourceMovieLibraryScanner.ts';
import type { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { ScanContext } from './MediaSourceScanner.ts';

type MockApiClient = MediaSourceApiClient;
type FullMovie = Movie & HasMediaSourceInfo;

class TestMovieScanner extends MediaSourceMovieLibraryScanner<
  'jellyfin',
  MockApiClient,
  Movie
> {
  readonly mediaSourceType = 'jellyfin' as const;

  getApiClient = vi
    .fn<() => Promise<MockApiClient>>()
    .mockResolvedValue({} as MockApiClient);
  getLibrarySize = vi.fn().mockResolvedValue(0);
  getLibraryContents = vi.fn<() => AsyncIterable<Movie>>();
  getSubtitles = vi.fn();
  scanMovie = vi.fn<() => Promise<Result<FullMovie>>>();
  scanMovieById = vi.fn<() => Promise<Result<FullMovie>>>();

  exposeScanSingleInternal(
    context: ScanContext<MockApiClient>,
    incoming: Movie,
    existing: ProgramCanonicalIdLookupResult,
  ) {
    return this.scanSingleInternal(context, incoming, existing);
  }
}

function makeSut() {
  const programDB = {
    upsertPrograms: vi.fn().mockResolvedValue([]),
  } as unknown as IProgramDB;
  const programMinter = {
    mintMovie: vi.fn().mockReturnValue({ program: {}, subtitles: [] }),
  } as unknown as ProgramDaoMinter;
  const scanner = new TestMovieScanner(
    {} as MediaSourceDB,
    programDB,
    {} as MediaSourceProgressService,
    {} as MeilisearchService,
    {} as ProgramConverter,
    programMinter,
    {} as ExternalSubtitleDownloader,
  );
  return { scanner, programDB };
}

function makeContext(force = false): ScanContext<MockApiClient> {
  return {
    library: { uuid: 'lib1', externalKey: 'ext1' } as MediaSourceLibrary,
    mediaSource: { uuid: 'ms1', replacePaths: [] } as unknown as MediaSourceOrm,
    force,
    apiClient: {} as MockApiClient,
    scannedEntities: 0,
    totalEntities: 0,
  };
}

const movie = (canonicalId: string) =>
  ({ externalId: 'm1', canonicalId, title: 'Movie' }) as unknown as FullMovie;

const existing = (canonicalId: string) =>
  ({
    uuid: 'p1',
    canonicalId,
    libraryId: 'lib1',
    externalKey: 'm1',
    state: 'ok',
  }) as ProgramCanonicalIdLookupResult;

describe('MediaSourceMovieLibraryScanner.scanSingleInternal', () => {
  test('rescans a movie whose full metadata changed though its listing did not', async () => {
    // A sidecar subtitle added later appears only in the full metadata's
    // streams; the library listing (no streams) still hashes the same
    const { scanner, programDB } = makeSut();
    scanner.scanMovie.mockResolvedValue(Result.success(movie('with-new-srt')));

    await scanner.exposeScanSingleInternal(
      makeContext(),
      movie('listing'),
      existing('listing'),
    );

    expect(programDB.upsertPrograms).toHaveBeenCalledTimes(1);
  });

  test('skips a movie whose full metadata is unchanged', async () => {
    const { scanner, programDB } = makeSut();
    scanner.scanMovie.mockResolvedValue(Result.success(movie('same')));

    await scanner.exposeScanSingleInternal(
      makeContext(),
      movie('listing'),
      existing('same'),
    );

    expect(programDB.upsertPrograms).not.toHaveBeenCalled();
  });

  test('a forced scan saves an unchanged movie anyway', async () => {
    const { scanner, programDB } = makeSut();
    scanner.scanMovie.mockResolvedValue(Result.success(movie('same')));

    await scanner.exposeScanSingleInternal(
      makeContext(true),
      movie('same'),
      existing('same'),
    );

    expect(programDB.upsertPrograms).toHaveBeenCalledTimes(1);
  });
});
