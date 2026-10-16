import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaSourceId } from '../db/schema/base.ts';
import { QueryError } from '../external/BaseApiClient.ts';
import { Result } from '../types/result.ts';
import { SubtitleExtractorTask } from './SubtitleExtractorTask.ts';

vi.mock('@/util/logging/LoggerFactory.js', () => {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    setBindings: vi.fn(),
  };
  return {
    LoggerFactory: {
      isInitialized: true,
      root: logger,
      child: () => logger,
    },
  };
});

// The task only needs TVGuideService as an injection token here, and importing
// the real one drags the DI container in through the scheduler, which cannot be
// constructed mid-import.
vi.mock('../services/TvGuideService.ts', () => ({
  TVGuideService: class {},
}));

// Used by PathCalculator (shared-storage lookups) and by the task's own
// check for whether an already-recorded subtitle file is still there.
const mockFileExists = vi.fn<(p: string) => Promise<boolean>>();
vi.mock('../util/fsUtil.ts', () => ({
  fileExists: (p: string) => mockFileExists(p),
}));

const MEDIA_SOURCE_ID = 'media-source-1' as MediaSourceId;
const PROGRAM_ID = 'program-1';
const CHANNEL_ID = 'channel-1';
const OTHER_CHANNEL_ID = 'channel-2';
const SOURCE_SUBTITLE_PATH = '/data/media/movie.eng.srt';
const SHARED_SUBTITLE_PATH = '/mnt/media/movie.eng.srt';
const CACHED_SUBTITLE_PATH = '/tmp/test-tunarr/cache/subtitles/ab/cd/abcd.srt';
const SUBTITLE_KEY = '/Videos/jf-item-1/jf-item-1/Subtitles/0/Stream.srt';

type SubtitleRow = {
  uuid: string;
  subtitleType: 'embedded' | 'sidecar';
  codec: string;
  language: string;
  path?: string | null;
  sourcePath?: string | null;
  sourceKey?: string | null;
  streamIndex?: number | null;
  isExtracted?: boolean;
};

function makeSubtitle(row: SubtitleRow) {
  return {
    default: false,
    forced: false,
    isExtracted: false,
    path: null,
    programId: PROGRAM_ID,
    sdh: false,
    sourceKey: null,
    sourcePath: null,
    streamIndex: null,
    ...row,
  };
}

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(opts: {
  subtitles: SubtitleRow[];
  sourceType?: 'jellyfin' | 'emby' | 'plex';
  replacePaths?: { localPath: string; serverPath: string }[];
  subtitlesEnabled?: boolean;
  enableSubtitleExtraction?: boolean;
  downloadedPath?: string;
  // What fetchToCache answers per subtitle key, ahead of downloadedPath
  fetchResults?: Record<string, unknown>;
  databaseDirectory?: string;
  programType?: 'movie' | 'episode';
  // What the media server answers when the item is read again
  itemResult?: unknown;
  // The rows mintSubtitles makes from that item
  minted?: Record<string, unknown>[];
  // A second channel with subtitles on, airing the same program
  otherChannelSubtitlesEnabled?: boolean;
}) {
  const sourceType = opts.sourceType ?? 'jellyfin';

  const mediaSource = {
    uuid: MEDIA_SOURCE_ID,
    name: 'Test Source',
    type: sourceType,
    uri: 'http://localhost:8096',
    accessToken: 'token',
    libraries: [],
    paths: [],
    replacePaths: opts.replacePaths ?? [],
  };

  const dbProgram = {
    uuid: PROGRAM_ID,
    externalKey: 'jf-item-1',
    mediaSourceId: MEDIA_SOURCE_ID,
    sourceType,
    type: opts.programType ?? 'episode',
    title: 'Test Movie',
    subtitles: opts.subtitles.map(makeSubtitle),
    externalIds: [],
  };

  const setSubtitlePath = vi.fn<(uuid: string, path: string) => Promise<void>>(
    () => Promise.resolve(),
  );
  const getSubtitlesByPath = vi.fn(() => Promise.resolve('subtitle contents'));
  const getSubtitlesByKey = vi.fn(() => Promise.resolve('subtitle contents'));

  // Stands in for the real downloader: runs the fetch callback the task hands
  // it, so the test also covers which client method the task reaches for.
  const fetchToCache = vi.fn(
    async (
      _item: unknown,
      details: { key?: string },
      cb: (args: { extension: string }) => Promise<unknown>,
      _fetchOpts?: { refresh?: boolean },
    ) => {
      await cb({ extension: 'srt' });
      const preset = opts.fetchResults?.[details.key ?? ''];
      if (preset) {
        return preset;
      }
      return opts.downloadedPath
        ? { type: 'written', path: opts.downloadedPath }
        : { type: 'failed' };
    },
  );

  const itemResult = () =>
    Promise.resolve(opts.itemResult ?? Result.success({ type: 'episode' }));
  const apiClient = {
    getSubtitlesByPath,
    getSubtitles: getSubtitlesByKey,
    getEpisode: vi.fn(itemResult),
    getMovie: vi.fn(itemResult),
  };
  const mintSubtitles = vi.fn(() => (opts.minted ?? []).map((r) => ({ ...r })));
  const replaceProgramSubtitles = vi.fn<
    (programId: string, rows: unknown[]) => Promise<void>
  >(() => Promise.resolve());

  // The program airs on every subtitled channel asked for
  const getChannelGuides = vi.fn((_range: unknown, channelIds: string[]) =>
    Promise.resolve(
      channelIds.map((id) => ({
        id,
        programs: [
          {
            type: 'content',
            id: PROGRAM_ID,
            program: {
              title: 'Test Movie',
              externalId: 'jf-item-1',
              mediaSourceId: MEDIA_SOURCE_ID,
              sourceType,
            },
          },
        ],
      })),
    ),
  );

  const task = new SubtitleExtractorTask(
    {
      get: () => Promise.resolve({}),
      getChannelGuides,
    } as never,
    {
      getAllChannels: () =>
        Promise.resolve([
          {
            uuid: CHANNEL_ID,
            subtitlesEnabled: opts.subtitlesEnabled ?? true,
          },
          {
            uuid: OTHER_CHANNEL_ID,
            subtitlesEnabled: opts.otherChannelSubtitlesEnabled ?? false,
          },
        ]),
    } as never,
    {
      getStream: () => Promise.reject(new Error('should not be called')),
    } as never,
    { getAll: () => Promise.resolve([mediaSource]) } as never,
    {
      ffmpegSettings: () => ({
        enableSubtitleExtraction: opts.enableSubtitleExtraction ?? false,
      }),
    } as never,
    {
      databaseDirectory: opts.databaseDirectory ?? '/tmp/test-tunarr',
    } as never,
    {
      getProgramById: () => Promise.resolve(dbProgram),
      setSubtitlePath,
      replaceProgramSubtitles,
    } as never,
    { fetchToCache } as never,
    {
      getJellyfinApiClientForMediaSource: () => Promise.resolve(apiClient),
      getEmbyApiClientForMediaSource: () => Promise.resolve(apiClient),
      getPlexApiClientForMediaSource: () => Promise.resolve(apiClient),
    } as never,
    { mintSubtitles } as never,
  );

  return {
    task,
    getChannelGuides,
    dbProgram,
    setSubtitlePath,
    fetchToCache,
    getSubtitlesByPath,
    getSubtitlesByKey,
    apiClient,
    mintSubtitles,
    replaceProgramSubtitles,
  };
}

async function run(harness: Harness) {
  const result = await harness.task.run({});
  expect(result.isSuccess()).toBe(true);
}

describe('SubtitleExtractorTask external subtitle top-up', () => {
  beforeEach(() => {
    mockFileExists.mockReset();
    mockFileExists.mockResolvedValue(false);
  });

  it('leaves a sidecar alone when its recorded file is still on disk', async () => {
    mockFileExists.mockImplementation((p) =>
      Promise.resolve(p === CACHED_SUBTITLE_PATH),
    );

    const harness = makeHarness({
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
          path: CACHED_SUBTITLE_PATH,
          sourceKey: SUBTITLE_KEY,
        },
      ],
    });

    await run(harness);

    expect(harness.fetchToCache).not.toHaveBeenCalled();
    expect(harness.setSubtitlePath).not.toHaveBeenCalled();
  });

  it('prefers storage shared with the media source over downloading', async () => {
    mockFileExists.mockImplementation((p) =>
      Promise.resolve(p === SHARED_SUBTITLE_PATH),
    );

    const harness = makeHarness({
      replacePaths: [{ localPath: '/mnt/media', serverPath: '/data/media' }],
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
          sourcePath: SOURCE_SUBTITLE_PATH,
          sourceKey: SUBTITLE_KEY,
        },
      ],
    });

    await run(harness);

    expect(harness.fetchToCache).not.toHaveBeenCalled();
    expect(harness.setSubtitlePath).toHaveBeenCalledWith(
      'sub-1',
      SHARED_SUBTITLE_PATH,
    );
  });

  it('downloads a sidecar the scan never managed to fetch', async () => {
    const harness = makeHarness({
      downloadedPath: CACHED_SUBTITLE_PATH,
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
          sourcePath: SOURCE_SUBTITLE_PATH,
          sourceKey: SUBTITLE_KEY,
        },
      ],
    });

    await run(harness);

    expect(harness.fetchToCache).toHaveBeenCalledTimes(1);
    expect(harness.setSubtitlePath).toHaveBeenCalledWith(
      'sub-1',
      CACHED_SUBTITLE_PATH,
    );
    // The in-memory row is kept in step with what was persisted.
    expect(harness.dbProgram.subtitles[0].path).toBe(CACHED_SUBTITLE_PATH);
  });

  it('re-downloads a sidecar whose cached copy has been deleted', async () => {
    const harness = makeHarness({
      downloadedPath: CACHED_SUBTITLE_PATH,
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
          // Recorded during a previous scan, but the file is gone.
          path: CACHED_SUBTITLE_PATH,
          sourceKey: SUBTITLE_KEY,
        },
      ],
    });

    await run(harness);

    expect(harness.fetchToCache).toHaveBeenCalledTimes(1);
  });

  it('addresses Jellyfin and Emby subtitles by their delivery route', async () => {
    for (const sourceType of ['jellyfin', 'emby'] as const) {
      const harness = makeHarness({
        sourceType,
        downloadedPath: CACHED_SUBTITLE_PATH,
        subtitles: [
          {
            uuid: 'sub-1',
            subtitleType: 'sidecar',
            codec: 'subrip',
            language: 'eng',
            sourceKey: SUBTITLE_KEY,
          },
        ],
      });

      await run(harness);

      expect(harness.getSubtitlesByPath).toHaveBeenCalledWith(SUBTITLE_KEY);
    }
  });

  it('addresses Plex subtitles by their stream key', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      downloadedPath: CACHED_SUBTITLE_PATH,
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
          sourceKey: '/library/streams/12345',
        },
      ],
    });

    await run(harness);

    expect(harness.getSubtitlesByKey).toHaveBeenCalledWith(
      '/library/streams/12345',
    );
  });

  it('does not record a path when the download fails', async () => {
    const harness = makeHarness({
      // The downloader returns nothing when it could not write a file.
      downloadedPath: undefined,
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
          sourceKey: SUBTITLE_KEY,
        },
      ],
    });

    await run(harness);

    expect(harness.setSubtitlePath).not.toHaveBeenCalled();
  });

  it('ignores embedded subtitles, which are extracted rather than fetched', async () => {
    const harness = makeHarness({
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'embedded',
          codec: 'subrip',
          language: 'eng',
          streamIndex: 2,
        },
      ],
    });

    await run(harness);

    expect(harness.fetchToCache).not.toHaveBeenCalled();
  });

  it('skips a sidecar with no way to reach it', async () => {
    const harness = makeHarness({
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
        },
      ],
    });

    await run(harness);

    expect(harness.fetchToCache).not.toHaveBeenCalled();
    expect(harness.setSubtitlePath).not.toHaveBeenCalled();
  });

  it('skips channels that have subtitles turned off', async () => {
    const harness = makeHarness({
      subtitlesEnabled: false,
      downloadedPath: CACHED_SUBTITLE_PATH,
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
          sourceKey: SUBTITLE_KEY,
        },
      ],
    });

    await run(harness);

    expect(harness.getChannelGuides).not.toHaveBeenCalled();
    expect(harness.fetchToCache).not.toHaveBeenCalled();
  });

  it('loads guides only for channels with subtitles turned on', async () => {
    const harness = makeHarness({ subtitles: [] });

    await run(harness);

    expect(harness.getChannelGuides).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      [CHANNEL_ID],
    );
  });
});

describe('SubtitleExtractorTask keeps downloaded copies fresh', () => {
  const KEY = '/library/streams/500';
  let dir: string;
  let copy: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-topup-'));
    copy = path.join(dir, 'cache', 'subtitles', 'ab', 'cd', 'abcd.srt');
    await fs.mkdir(path.dirname(copy), { recursive: true });
    await fs.writeFile(copy, '1\nOld\n');
    mockFileExists.mockReset();
    mockFileExists.mockImplementation((p) =>
      fs.access(p).then(
        () => true,
        () => false,
      ),
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function age(file: string, hours: number) {
    const then = new Date(Date.now() - hours * 60 * 60 * 1000);
    await fs.utimes(file, then, then);
  }

  function harnessFor(extra: Partial<SubtitleRow> = {}) {
    return makeHarness({
      sourceType: 'plex',
      databaseDirectory: dir,
      fetchResults: { [KEY]: { type: 'replaced', path: copy } },
      subtitles: [
        {
          uuid: 'sub-1',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'eng',
          path: copy,
          sourceKey: KEY,
          ...extra,
        },
      ],
    });
  }

  it('fetches a copy older than 6 hours again', async () => {
    await age(copy, 7);
    const harness = harnessFor();

    await run(harness);

    expect(harness.fetchToCache).toHaveBeenCalledTimes(1);
    expect(harness.fetchToCache.mock.calls[0]?.[3]).toEqual({ refresh: true });
    expect(harness.getSubtitlesByKey).toHaveBeenCalledWith(KEY);
    // Same cache name, so nothing to record
    expect(harness.setSubtitlePath).not.toHaveBeenCalled();
  });

  it('leaves a copy younger than 6 hours alone', async () => {
    await age(copy, 1);
    const harness = harnessFor();

    await run(harness);

    expect(harness.fetchToCache).not.toHaveBeenCalled();
  });

  it('does not refresh a copy whose live file is on shared storage', async () => {
    await age(copy, 7);
    const live = path.join(dir, 'media', 'movie.en.srt');
    await fs.mkdir(path.dirname(live), { recursive: true });
    await fs.writeFile(live, '1\nNew\n');
    const harness = harnessFor({ sourcePath: live });

    await run(harness);

    // Playback reads the live file ahead of the copy
    expect(harness.fetchToCache).not.toHaveBeenCalled();
    expect(harness.setSubtitlePath).not.toHaveBeenCalled();
  });
});

describe('SubtitleExtractorTask heals a sidecar the media server answers 404 for', () => {
  const OLD_KEY = '/library/streams/100';
  const NEW_KEY = '/library/streams/200';
  const OTHER_KEY = '/library/streams/300';
  const NEW_COPY = '/tmp/test-tunarr/cache/subtitles/ne/w0/new.srt';
  const OTHER_COPY = '/tmp/test-tunarr/cache/subtitles/ot/he/other.srt';

  const sidecar = (sourceKey: string, language = 'eng') => ({
    subtitleType: 'sidecar',
    codec: 'subrip',
    language,
    forced: false,
    sdh: false,
    default: false,
    sourceKey,
    sourcePath: null,
    path: null,
    streamIndex: null,
    programId: PROGRAM_ID,
  });

  beforeEach(() => {
    mockFileExists.mockReset();
    mockFileExists.mockImplementation((p) => Promise.resolve(p === OTHER_COPY));
  });

  function missingRow(): SubtitleRow {
    return {
      uuid: 'sub-old',
      subtitleType: 'sidecar',
      codec: 'subrip',
      language: 'eng',
      sourceKey: OLD_KEY,
    };
  }

  it('re-reads the item, saves its subtitles as they are now and downloads the new stream, once', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      fetchResults: {
        [OLD_KEY]: { type: 'not_found' },
        [NEW_KEY]: { type: 'written', path: NEW_COPY },
      },
      minted: [sidecar(NEW_KEY)],
      subtitles: [missingRow()],
    });

    await run(harness);

    expect(harness.apiClient.getEpisode).toHaveBeenCalledExactlyOnceWith(
      'jf-item-1',
    );
    expect(harness.mintSubtitles).toHaveBeenCalledTimes(1);
    expect(harness.replaceProgramSubtitles).toHaveBeenCalledTimes(1);
    expect(harness.replaceProgramSubtitles.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ sourceKey: NEW_KEY, path: NEW_COPY }),
    ]);
    // The old key once, the new key once
    expect(harness.fetchToCache).toHaveBeenCalledTimes(2);
    expect(harness.setSubtitlePath).not.toHaveBeenCalled();
  });

  it('keeps the file of a sidecar that is still the same stream', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      fetchResults: {
        [OLD_KEY]: { type: 'not_found' },
        [NEW_KEY]: { type: 'written', path: NEW_COPY },
      },
      minted: [sidecar(NEW_KEY), sidecar(OTHER_KEY, 'spa')],
      subtitles: [
        missingRow(),
        {
          uuid: 'sub-other',
          subtitleType: 'sidecar',
          codec: 'subrip',
          language: 'spa',
          sourceKey: OTHER_KEY,
          path: OTHER_COPY,
        },
      ],
    });

    await run(harness);

    expect(harness.replaceProgramSubtitles.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ sourceKey: NEW_KEY, path: NEW_COPY }),
      expect.objectContaining({ sourceKey: OTHER_KEY, path: OTHER_COPY }),
    ]);
    // Nothing fetched for the stream that is still there
    expect(
      harness.fetchToCache.mock.calls.map(([, details]) => details.key),
    ).toEqual([OLD_KEY, NEW_KEY]);
  });

  it('reads a film again with the movie call', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      programType: 'movie',
      fetchResults: { [OLD_KEY]: { type: 'not_found' } },
      minted: [],
      subtitles: [missingRow()],
    });

    await run(harness);

    expect(harness.apiClient.getMovie).toHaveBeenCalledExactlyOnceWith(
      'jf-item-1',
    );
    expect(harness.apiClient.getEpisode).not.toHaveBeenCalled();
  });

  it('leaves an item the media server no longer has to the next scan', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      fetchResults: { [OLD_KEY]: { type: 'not_found' } },
      itemResult: Result.failure(QueryError.create('not_found', '404')),
      subtitles: [missingRow()],
    });

    await run(harness);

    expect(harness.mintSubtitles).not.toHaveBeenCalled();
    expect(harness.replaceProgramSubtitles).not.toHaveBeenCalled();
  });

  it('leaves the rows alone while the media server still lists the stream that 404s', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      fetchResults: { [OLD_KEY]: { type: 'not_found' } },
      // Not rescanned yet: the item still lists the same stream
      minted: [sidecar(OLD_KEY)],
      subtitles: [missingRow()],
    });

    await run(harness);

    expect(harness.apiClient.getEpisode).toHaveBeenCalledTimes(1);
    // No second fetch, which would only hand back the stale copy
    expect(harness.fetchToCache).toHaveBeenCalledTimes(1);
    expect(harness.replaceProgramSubtitles).not.toHaveBeenCalled();
  });

  it('heals a program airing on two channels once a run', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      otherChannelSubtitlesEnabled: true,
      fetchResults: { [OLD_KEY]: { type: 'not_found' } },
      // The heal can't succeed: the item is gone as well
      itemResult: Result.failure(QueryError.create('not_found', '404')),
      subtitles: [missingRow()],
    });

    await run(harness);

    expect(harness.getChannelGuides).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      [CHANNEL_ID, OTHER_CHANNEL_ID],
    );
    expect(harness.apiClient.getEpisode).toHaveBeenCalledTimes(1);
    expect(harness.fetchToCache).toHaveBeenCalledTimes(1);
    expect(harness.replaceProgramSubtitles).not.toHaveBeenCalled();
  });

  it('clears the rows when the item lists no subtitles any more', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      fetchResults: { [OLD_KEY]: { type: 'not_found' } },
      minted: [],
      subtitles: [missingRow()],
    });

    await run(harness);

    expect(harness.replaceProgramSubtitles).toHaveBeenCalledExactlyOnceWith(
      PROGRAM_ID,
      [],
    );
  });

  it('does not loop when the new stream answers 404 too', async () => {
    const harness = makeHarness({
      sourceType: 'plex',
      fetchResults: {
        [OLD_KEY]: { type: 'not_found' },
        [NEW_KEY]: { type: 'not_found' },
      },
      minted: [sidecar(NEW_KEY)],
      subtitles: [missingRow()],
    });

    await run(harness);

    expect(harness.apiClient.getEpisode).toHaveBeenCalledTimes(1);
    expect(harness.replaceProgramSubtitles).toHaveBeenCalledTimes(1);
    expect(harness.replaceProgramSubtitles.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ sourceKey: NEW_KEY, path: null }),
    ]);
    expect(harness.fetchToCache).toHaveBeenCalledTimes(2);
  });
});
