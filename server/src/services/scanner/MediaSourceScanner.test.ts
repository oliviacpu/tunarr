import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { NewProgramWithRelations } from '../../db/schema/derivedTypes.js';
import type { QueryResult } from '../../external/BaseApiClient.ts';
import { QueryError } from '../../external/BaseApiClient.ts';
import { ExternalSubtitleDownloader } from '../../stream/ExternalSubtitleDownloader.ts';
import { Result } from '../../types/result.ts';
import type { FileSystemService } from '../FileSystemService.ts';
import type { GetSubtitlesRequest } from './MediaSourceScanner.ts';
import { MediaSourceScanner } from './MediaSourceScanner.ts';

const { fakeLogger } = vi.hoisted(() => {
  const fakeLogger = {
    trace: vi.fn(),
    http_out: vi.fn(),
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

class TestScanner extends MediaSourceScanner<'movies', 'plex', unknown> {
  readonly type = 'movies';
  readonly mediaSourceType = 'plex';

  scanSingle = vi.fn();
  scanInternal = vi.fn();
  getApiClient = vi.fn();
  getLibrarySize = vi.fn();
  getSubtitles = vi.fn();

  exposeDownloadExternalSubtitleStreams(
    program: NewProgramWithRelations,
    fetch: (req: GetSubtitlesRequest) => Promise<QueryResult<string>>,
  ) {
    return this.downloadExternalSubtitleStreams(program, [], fetch);
  }
}

const MISSING_KEY = '/library/streams/173516';
const PRESENT_KEY = '/library/streams/173517';

function makeProgram() {
  const sidecar = (sourceKey: string) => ({
    subtitleType: 'sidecar',
    codec: 'srt',
    sourceKey,
    sourcePath: null,
    path: null,
    streamIndex: null,
  });
  return {
    program: {
      uuid: 'program-1',
      externalKey: '4242',
      mediaSourceId: 'media-source-1',
      sourceType: 'plex',
      title: 'The Movie',
    },
    subtitles: [sidecar(MISSING_KEY), sidecar(PRESENT_KEY)],
  } as unknown as NewProgramWithRelations;
}

let cacheFolder: string;
let scanner: TestScanner;

beforeEach(async () => {
  vi.clearAllMocks();
  cacheFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-scan-subs-'));
  const downloader = new ExternalSubtitleDownloader({
    getSubtitleCacheFolder: () => cacheFolder,
  } as FileSystemService);
  scanner = new TestScanner({} as MediaSourceDB, downloader);
});

afterEach(async () => {
  await fs.rm(cacheFolder, { recursive: true, force: true });
});

describe('MediaSourceScanner.downloadExternalSubtitleStreams', () => {
  test('a subtitle the media server answers 404 for is one info line, and the next one still downloads', async () => {
    const program = makeProgram();

    await scanner.exposeDownloadExternalSubtitleStreams(program, ({ key }) =>
      Promise.resolve(
        key === MISSING_KEY
          ? Result.failure<string, QueryError>(
              QueryError.create(
                'not_found',
                'Request failed with status code 404',
              ),
            )
          : Result.success<string, QueryError>('1\nHello\n'),
      ),
    );

    const [missing, present] = program.subtitles;
    expect(missing?.path).toBeNull();
    expect(present?.path?.startsWith(cacheFolder)).toBe(true);

    expect(fakeLogger.info).toHaveBeenCalledTimes(1);
    expect(fakeLogger.info).toHaveBeenCalledWith(
      'Plex no longer has subtitle stream 173516 for "The Movie" (item 4242); skipped until Plex rescans the item.',
    );
    expect(fakeLogger.warn).not.toHaveBeenCalled();
    expect(fakeLogger.error).not.toHaveBeenCalled();
  });

  test('any other failure is still logged with its error, and the next subtitle still downloads', async () => {
    const program = makeProgram();
    const error = QueryError.create(
      'generic_request_error',
      'Request failed with status code 500',
    );

    await scanner.exposeDownloadExternalSubtitleStreams(program, ({ key }) =>
      Promise.resolve(
        key === MISSING_KEY
          ? Result.failure<string, QueryError>(error)
          : Result.success<string, QueryError>('1\nHello\n'),
      ),
    );

    const [failed, present] = program.subtitles;
    expect(failed?.path).toBeNull();
    expect(present?.path?.startsWith(cacheFolder)).toBe(true);

    expect(fakeLogger.warn).toHaveBeenCalledTimes(1);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      error,
      'Error while requesting external subtitle stream: %s',
      'Request failed with status code 500',
    );
    expect(fakeLogger.info).not.toHaveBeenCalled();
  });
});
