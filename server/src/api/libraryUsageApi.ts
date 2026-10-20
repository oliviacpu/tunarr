import { LibraryUsedBySchema } from '@tunarr/types/api';
import { container } from '../container.ts';
import {
  LibraryUsageService,
  type LibraryEntityKind,
} from '../db/LibraryUsageService.ts';
import type { RouterPluginAsyncCallback } from '../types/serverType.ts';

// eslint-disable-next-line @typescript-eslint/require-await
export const libraryUsageApi: RouterPluginAsyncCallback = async (fastify) => {
  for (const [path, kind, tag] of [
    ['/filler-lists/used-by', 'fillerLists', 'Filler Lists'],
    ['/custom-shows/used-by', 'customShows', 'Custom Shows'],
    ['/smart_collections/used-by', 'smartCollections', 'Smart Collections'],
  ] satisfies [string, LibraryEntityKind, string][]) {
    fastify.get(
      path,
      {
        schema: { tags: [tag], response: { 200: LibraryUsedBySchema } },
      },
      async (_, reply) =>
        reply.send(await container.get(LibraryUsageService).getUsedBy(kind)),
    );
  }
};
