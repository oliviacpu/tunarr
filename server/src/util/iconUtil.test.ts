import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  deleteIfLocalAndCleared,
  extractLocalUploadFilename,
  resolveIconUrl,
  uploadedImageUrl,
  ImmutableCacheControl,
  versionedUploadCacheControl,
} from './iconUtil.ts';
import * as fsUtil from './fsUtil.ts';

vi.mock('./fsUtil.ts', () => ({
  deleteUploadedFile: vi.fn(),
}));

describe('iconUtil', () => {
  describe('uploadedImageUrl', () => {
    const origin = 'https://tunarr.example';
    const logo = new TextEncoder().encode('first logo');

    test('points at the uploaded file, with a version from its contents', () => {
      expect(uploadedImageUrl(origin, 'ch1_icon.png', logo)).toMatch(
        /^https:\/\/tunarr\.example\/images\/uploads\/ch1_icon\.png\?v=[0-9a-f]{12}$/,
      );
    });

    // Plex, its apps and Tunarr's image cache key images by URL. A replaced
    // logo keeps its file name, so only the version can tell them apart.
    test('a different image under the same name gets a different URL', () => {
      expect(uploadedImageUrl(origin, 'ch1_icon.png', logo)).not.toBe(
        uploadedImageUrl(
          origin,
          'ch1_icon.png',
          new TextEncoder().encode('second logo'),
        ),
      );
    });

    test('uploading the same image again keeps its URL', () => {
      expect(uploadedImageUrl(origin, 'ch1_icon.png', logo)).toBe(
        uploadedImageUrl(origin, 'ch1_icon.png', Uint8Array.from(logo)),
      );
    });

    // Clearing a channel's icon deletes the upload, found from its URL
    test('the file name can still be read back from the URL', () => {
      expect(
        extractLocalUploadFilename(
          uploadedImageUrl(origin, 'ch1_icon.png', logo),
        ),
      ).toBe('ch1_icon.png');
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
