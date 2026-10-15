import { tag } from '@tunarr/types';
import { randomUUID } from 'node:crypto';
import { container } from '../../src/container.ts';
import type {
  MediaSourceId,
  MediaSourceName,
} from '../../src/db/schema/base.ts';
import type { DrizzleDBAccess } from '../../src/db/schema/index.ts';
import { MediaSource } from '../../src/db/schema/MediaSource.ts';
import { MediaSourceLibrary } from '../../src/db/schema/MediaSourceLibrary.ts';
import { KEYS } from '../../src/types/inject.ts';
import type { FakePlex } from './fakePlex.ts';

/**
 * Inserts a Plex media source pointing at a stand-in Plex server, with its
 * movie library.
 */
export function seedFakePlexSource(fake: FakePlex): MediaSourceId {
  const drizzle = container.get<DrizzleDBAccess>(KEYS.DrizzleDB);
  const mediaSourceId = tag<MediaSourceId>(randomUUID());
  const now = Date.now();
  drizzle
    .insert(MediaSource)
    .values({
      uuid: mediaSourceId,
      accessToken: 'fake-token',
      clientIdentifier: 'fake-plex',
      index: 0,
      name: tag<MediaSourceName>(`fake-plex-${mediaSourceId}`),
      type: 'plex',
      uri: fake.url,
      // Set, so getting a client doesn't look the user up on plex.tv
      userId: 'fake-user',
      username: 'fake',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  drizzle
    .insert(MediaSourceLibrary)
    .values({
      uuid: randomUUID(),
      name: 'Movies',
      mediaType: 'movies',
      mediaSourceId,
      externalKey: String(fake.sectionId),
      enabled: true,
    })
    .run();
  return mediaSourceId;
}
