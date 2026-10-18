import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file sits next to the resources folder both in the source tree (src/)
// and in the bundle (dist/, where every module shares the bundle's
// import.meta.url), so the folder resolves the same way in both.
const ServerResourcesDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'resources',
);

/**
 * A file the server ships with (src/resources, copied to dist/resources). In
 * the packaged binary it lives in the binary's snapshot, which only the server
 * can read: copy it out before handing it to another program such as ffmpeg.
 */
export function serverResourcePath(...segments: string[]) {
  return path.join(ServerResourcesDirectory, ...segments);
}
