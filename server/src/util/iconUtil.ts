import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ChannelIcon } from '@tunarr/types';
import { deleteUploadedFile } from './fsUtil.js';
import { isNonEmptyString } from './index.js';

export const LocalUploadPathPrefix = '/images/uploads/';

/**
 * For a picture whose URL changes whenever its bytes do. Caches may keep it for
 * a year without asking again.
 */
export const ImmutableCacheControl = 'public, max-age=31536000, immutable';

/**
 * The Cache-Control for a successful response to `url`, when the URL is an
 * upload carrying a version (`?v=`). Every upload URL Tunarr hands out has one,
 * and a different image gets a different version, so the response can be
 * cached for good. Older links without a version keep revalidating.
 */
export function versionedUploadCacheControl(
  url: string,
  statusCode: number,
): string | undefined {
  if (statusCode !== 200 && statusCode !== 304) {
    return undefined;
  }
  const parsed = URL.parse(url, 'http://localhost');
  if (
    !parsed?.pathname.startsWith(LocalUploadPathPrefix) ||
    !isNonEmptyString(parsed.searchParams.get('v'))
  ) {
    return undefined;
  }
  return ImmutableCacheControl;
}

/**
 * If the given URL points to a locally-uploaded file under the server's
 * /images/uploads/ path, returns the bare filename. Otherwise returns null.
 */
export function extractLocalUploadFilename(url: string): string | null {
  if (!isNonEmptyString(url)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!parsed.pathname.startsWith(LocalUploadPathPrefix)) {
    return null;
  }

  return parsed.pathname.slice(LocalUploadPathPrefix.length);
}

/**
 * The URL for an uploaded image. Uploads keep their file name (a channel's logo
 * is always `<channel id>_icon.<ext>`), so a replaced image would keep its URL,
 * and everything that caches images by URL (Plex, its apps, Tunarr's own image
 * cache) would go on showing the old one. A short hash of the contents in the
 * query string gives each different image its own URL; uploading the same image
 * again keeps it.
 */
export function uploadedImageUrl(
  origin: string,
  filename: string,
  contents: Uint8Array,
): string {
  const version = createHash('sha256')
    .update(contents)
    .digest('hex')
    .slice(0, 12);
  return `${origin}${LocalUploadPathPrefix}${filename}?v=${version}`;
}

/**
 * Returns the URL to use for a channel icon, or null if no icon should be shown.
 * - Custom icon (non-empty path): returns the path
 * - Default fallback enabled (useDefaultIconFallback === true, or icon missing): returns defaultUrl
 * - No icon (path empty, useDefaultIconFallback === false): returns null
 */
export function resolveIconUrl(
  icon: ChannelIcon | null | undefined,
  defaultUrl: string,
): string | null {
  if (!icon) return defaultUrl;
  if (isNonEmptyString(icon.path)) return icon.path;
  return icon.useDefaultIconFallback !== false ? defaultUrl : null;
}

/**
 * Deletes the old icon file from disk if it was a local upload and the icon
 * has been cleared (newIconPath is empty). No-ops otherwise.
 * Throws if the file exists but cannot be deleted.
 */
export async function deleteIfLocalAndCleared(
  oldIconPath: string,
  newIconPath: string,
  databaseDirectory: string,
): Promise<void> {
  if (!isNonEmptyString(oldIconPath) || isNonEmptyString(newIconPath)) {
    return;
  }

  const filename = extractLocalUploadFilename(oldIconPath);
  if (!filename) {
    return;
  }

  await deleteUploadedFile(
    path.join(databaseDirectory, 'images', 'uploads', filename),
  );
}
