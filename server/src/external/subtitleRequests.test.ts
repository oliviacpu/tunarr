import { tag } from '@tunarr/types';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { v4 } from 'uuid';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import type { MediaSourceName, MediaSourceType } from '../db/schema/base.ts';
import type { ApiClientOptions, QueryResult } from './BaseApiClient.ts';
import { EmbyApiClient } from './emby/EmbyApiClient.ts';
import { JellyfinApiClient } from './jellyfin/JellyfinApiClient.ts';
import { PlexApiClient } from './plex/PlexApiClient.ts';

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

vi.mock('@/util/version.js', () => ({
  getTunarrVersion: () => '1.0.0-test',
}));

let server: http.Server;
let uri: string;

// A path containing `/missing/` answers 404 and `/broken/` answers 500, the
// way a media server does for a removed subtitle file and a fault of its own.
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.includes('/missing/')) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html><body>404 Not Found</body></html>');
    } else if (url.includes('/broken/')) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('1\nHello\n');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  uri = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function options(type: MediaSourceType): ApiClientOptions {
  return {
    mediaSource: {
      uri,
      accessToken: 'token',
      name: tag<MediaSourceName>('test'),
      uuid: tag(v4()),
      userId: null,
      username: null,
      type,
      mediaType: null,
      libraries: [],
      paths: [],
      replacePaths: [],
      sendPlayStatusUpdates: false,
      consecutiveAuthFailures: 0,
    },
  };
}

const canonicalizer = { getCanonicalId: () => '' };

type FetchSubtitle = (key: string) => Promise<QueryResult<string>>;

// The call each source's scanner makes for an external subtitle.
const subtitleFetches: [string, () => FetchSubtitle][] = [
  [
    'Plex getSubtitles',
    () => {
      const client = new PlexApiClient(canonicalizer, options('plex'));
      return (key) => client.getSubtitles(key);
    },
  ],
  [
    'Jellyfin getSubtitlesByPath',
    () => {
      const client = new JellyfinApiClient(canonicalizer, options('jellyfin'));
      return (key) => client.getSubtitlesByPath(key);
    },
  ],
  [
    'Emby getSubtitlesByPath',
    () => {
      const client = new EmbyApiClient(canonicalizer, options('emby'));
      return (key) => client.getSubtitlesByPath(key);
    },
  ],
];

describe.each(subtitleFetches)('%s', (_name, makeFetch) => {
  test('returns the subtitle text', async () => {
    const result = await makeFetch()('/library/streams/1');

    expect(result.isSuccess()).toBe(true);
    expect(result.get()).toBe('1\nHello\n');
  });

  test('a 404 is a not_found failure, logged at debug without warnings', async () => {
    const result = await makeFetch()('/missing/173516');

    expect(result.isFailure()).toBe(true);
    expect(result.error.type).toBe('not_found');
    expect(fakeLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Not found: '),
    );
    expect(fakeLogger.warn).not.toHaveBeenCalled();
    expect(fakeLogger.error).not.toHaveBeenCalled();
  });

  test('a 500 is a generic failure and is still warned about', async () => {
    const result = await makeFetch()('/broken/173516');

    expect(result.isFailure()).toBe(true);
    expect(result.error.type).toBe('generic_request_error');
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('API client response error'),
      expect.anything(),
      500,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
