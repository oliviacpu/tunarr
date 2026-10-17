import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  deleteIfLocalAndCleared,
  extractLocalUploadFilename,
  localUploadFile,
  publicLinkOrigin,
  resolveIconUrl,
  uploadedImageUrl,
  ImmutableCacheControl,
  versionedUploadCacheControl,
  uploadsDirectory,
} from './iconUtil.ts';
import * as fsUtil from './fsUtil.ts';

vi.mock('./fsUtil.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof fsUtil>()),
  deleteUploadedFile: vi.fn(),
}));

describe('iconUtil', () => {
  describe('uploadedImageUrl', () => {
    const request = { protocol: 'https', host: 'tunarr.example' };
    const logo = new TextEncoder().encode('first logo');

    test('points at the uploaded file, with a version from its contents', () => {
      expect(
        uploadedImageUrl(undefined, request, 'ch1_icon.png', logo),
      ).toMatch(
        /^https:\/\/tunarr\.example\/images\/uploads\/ch1_icon\.png\?v=[0-9a-f]{12}$/,
      );
    });

    // Plex, its apps and Tunarr's image cache key images by URL. A replaced
    // logo keeps its file name, so only the version can tell them apart.
    test('a different image under the same name gets a different URL', () => {
      expect(
        uploadedImageUrl(undefined, request, 'ch1_icon.png', logo),
      ).not.toBe(
        uploadedImageUrl(
          undefined,
          request,
          'ch1_icon.png',
          new TextEncoder().encode('second logo'),
        ),
      );
    });

    test('uploading the same image again keeps its URL', () => {
      expect(uploadedImageUrl(undefined, request, 'ch1_icon.png', logo)).toBe(
        uploadedImageUrl(
          undefined,
          request,
          'ch1_icon.png',
          Uint8Array.from(logo),
        ),
      );
    });

    // Clearing a channel's icon deletes the upload, found from its URL
    test('the file name can still be read back from the URL', () => {
      expect(
        extractLocalUploadFilename(
          uploadedImageUrl(undefined, request, 'ch1_icon.png', logo),
        ),
      ).toBe('ch1_icon.png');
    });
  });

  describe('uploads behind a proxy', () => {
    const logo = new TextEncoder().encode('logo');

    // The web UI behind a proxy that terminates HTTPS: Tunarr sees plain http
    test('an upload gets the public URL, not the plain-http request', () => {
      expect(
        uploadedImageUrl(
          'https://tunarr.example.com',
          { protocol: 'http', host: 'tunarr.example.com' },
          'ch1_icon.png',
          logo,
        ),
      ).toMatch(
        /^https:\/\/tunarr\.example\.com\/images\/uploads\/ch1_icon\.png\?v=/,
      );
    });

    // The web UI through an SSH tunnel: the request's host is localhost
    test('an upload made on localhost still gets the public URL', () => {
      expect(
        uploadedImageUrl(
          'https://tunarr.example.com/',
          { protocol: 'http', host: 'localhost:8000' },
          'ch1_icon.png',
          logo,
        ),
      ).toMatch(/^https:\/\/tunarr\.example\.com\/images\/uploads\//);
    });

    test('without a public URL, the request it came in on', () => {
      expect(
        uploadedImageUrl(
          undefined,
          { protocol: 'http', host: '192.168.1.10:8000' },
          'ch1_icon.png',
          logo,
        ),
      ).toMatch(/^http:\/\/192\.168\.1\.10:8000\/images\/uploads\//);
      expect(
        publicLinkOrigin('', { protocol: 'http', host: '192.168.1.10:8000' }),
      ).toBe('http://192.168.1.10:8000');
    });
  });

  describe('extractLocalUploadFilename', () => {
    test('returns null for an empty string', () => {
      expect(extractLocalUploadFilename('')).toBeNull();
    });

    test('returns null for an invalid URL', () => {
      expect(extractLocalUploadFilename('not a url')).toBeNull();
    });

    test('returns null for an external URL', () => {
      expect(
        extractLocalUploadFilename('https://example.com/image.png'),
      ).toBeNull();
    });

    test('returns null for a server URL not under /images/uploads/', () => {
      expect(
        extractLocalUploadFilename(
          'http://localhost:8000/images/other/icon.png',
        ),
      ).toBeNull();
    });

    test('returns the filename for a local upload URL', () => {
      expect(
        extractLocalUploadFilename(
          'http://localhost:8000/images/uploads/abc123_icon.png',
        ),
      ).toBe('abc123_icon.png');
    });

    test('returns the filename regardless of host or port', () => {
      expect(
        extractLocalUploadFilename(
          'http://192.168.1.10:8000/images/uploads/channel_icon.jpg',
        ),
      ).toBe('channel_icon.jpg');
    });
  });

  describe('resolveIconUrl', () => {
    const defaultUrl = 'http://localhost:8000/images/tunarr.png';

    test('returns defaultUrl when icon is null', () => {
      expect(resolveIconUrl(null, defaultUrl)).toBe(defaultUrl);
    });

    test('returns defaultUrl when icon is undefined', () => {
      expect(resolveIconUrl(undefined, defaultUrl)).toBe(defaultUrl);
    });

    test('returns custom path when icon.path is non-empty', () => {
      const icon = {
        path: 'http://localhost:8000/images/uploads/abc.png',
        width: 0,
        duration: 0,
        position: 'bottom-right' as const,
      };
      expect(resolveIconUrl(icon, defaultUrl)).toBe(icon.path);
    });

    test('returns defaultUrl when path is empty and useDefaultIconFallback is true', () => {
      const icon = {
        path: '',
        width: 0,
        duration: 0,
        position: 'bottom-right' as const,
        useDefaultIconFallback: true,
      };
      expect(resolveIconUrl(icon, defaultUrl)).toBe(defaultUrl);
    });

    test('returns defaultUrl when path is empty and useDefaultIconFallback is undefined', () => {
      const icon = {
        path: '',
        width: 0,
        duration: 0,
        position: 'bottom-right' as const,
      };
      expect(resolveIconUrl(icon, defaultUrl)).toBe(defaultUrl);
    });

    test('returns null when path is empty and useDefaultIconFallback is false', () => {
      const icon = {
        path: '',
        width: 0,
        duration: 0,
        position: 'bottom-right' as const,
        useDefaultIconFallback: false,
      };
      expect(resolveIconUrl(icon, defaultUrl)).toBeNull();
    });
  });

  describe('deleteIfLocalAndCleared', () => {
    const dbDir = '/data/tunarr';
    const localIconUrl = 'http://localhost:8000/images/uploads/abc123_icon.png';

    beforeEach(() => {
      vi.mocked(fsUtil.deleteUploadedFile).mockResolvedValue(undefined);
    });

    test('does nothing when old icon path is empty', async () => {
      await deleteIfLocalAndCleared('', '', dbDir);
      expect(fsUtil.deleteUploadedFile).not.toHaveBeenCalled();
    });

    test('does nothing when new icon path is non-empty (icon not cleared)', async () => {
      await deleteIfLocalAndCleared(localIconUrl, localIconUrl, dbDir);
      expect(fsUtil.deleteUploadedFile).not.toHaveBeenCalled();
    });

    test('does nothing when old icon is an external URL', async () => {
      await deleteIfLocalAndCleared('https://example.com/image.png', '', dbDir);
      expect(fsUtil.deleteUploadedFile).not.toHaveBeenCalled();
    });

    test('deletes the file when a local icon is cleared', async () => {
      await deleteIfLocalAndCleared(localIconUrl, '', dbDir);
      expect(fsUtil.deleteUploadedFile).toHaveBeenCalledWith(
        '/data/tunarr/images/uploads/abc123_icon.png',
      );
    });

    test('propagates errors from deleteUploadedFile', async () => {
      vi.mocked(fsUtil.deleteUploadedFile).mockRejectedValue(
        new Error('ENOENT: no such file'),
      );
      await expect(
        deleteIfLocalAndCleared(localIconUrl, '', dbDir),
      ).rejects.toThrow('ENOENT: no such file');
    });
  });
});

describe('versionedUploadCacheControl', () => {
  test('a versioned upload may be cached for good', () => {
    expect(
      versionedUploadCacheControl('/images/uploads/ch1_icon.png?v=ab12cd', 200),
    ).toBe(ImmutableCacheControl);
    expect(
      versionedUploadCacheControl('/images/uploads/ch1_icon.png?v=ab12cd', 304),
    ).toBe(ImmutableCacheControl);
  });

  test('leaves unversioned uploads, other paths and errors alone', () => {
    expect(
      versionedUploadCacheControl('/images/uploads/ch1_icon.png', 200),
    ).toBeUndefined();
    expect(
      versionedUploadCacheControl('/images/uploads/ch1_icon.png?v=', 200),
    ).toBeUndefined();
    expect(
      versionedUploadCacheControl('/images/tunarr.png?v=ab12cd', 200),
    ).toBeUndefined();
    expect(
      versionedUploadCacheControl('/images/uploads/gone.png?v=ab12cd', 404),
    ).toBeUndefined();
  });
});

describe('localUploadFile', () => {
  async function withUploads(run: (dir: string) => Promise<void>) {
    const db = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-uploads-'));
    const dir = uploadsDirectory(db);
    await fs.mkdir(dir, { recursive: true });
    try {
      await run(dir);
    } finally {
      await fs.rm(db, { recursive: true, force: true });
    }
  }

  test('finds an upload on disk from its public URL, version and all', async () => {
    await withUploads(async (dir) => {
      await fs.writeFile(path.join(dir, 'card 6.png'), 'png');
      expect(
        await localUploadFile(
          'https://tv.example/images/uploads/card%206.png?v=0123456789ab',
          dir,
        ),
      ).toBe(path.join(dir, 'card 6.png'));
    });
  });

  test.each([
    ['a missing upload', 'https://tv.example/images/uploads/gone.png'],
    ['another path', 'https://tv.example/images/generic-offline-screen.png'],
    ['a remote image', 'https://cdn.example/cards/card.png'],
    ['a relative URL', '/images/uploads/card.png'],
    ['an encoded path escape', 'https://tv.example/images/uploads/..%2Fdb.db'],
    [
      'an encoded subfolder',
      'https://tv.example/images/uploads/sub%2Fcard.png',
    ],
    ['a bad escape', 'https://tv.example/images/uploads/%E0%A4%A.png'],
    ['no URL', undefined],
  ])('leaves %s to be fetched over HTTP', async (_, url) => {
    await withUploads(async (dir) => {
      await fs.writeFile(path.join(dir, 'card.png'), 'png');
      await fs.writeFile(path.join(path.dirname(dir), 'db.db'), 'db');
      expect(await localUploadFile(url, dir)).toBeUndefined();
    });
  });
});
