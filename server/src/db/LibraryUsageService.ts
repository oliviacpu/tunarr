import type { LibraryUsedBy } from '@tunarr/types/api';
import { inject, injectable } from 'inversify';
import { KEYS } from '../types/inject.ts';
import type { LineupRepository } from './channel/LineupRepository.ts';
import { Channel } from './schema/Channel.ts';
import { ChannelFillerShow } from './schema/ChannelFillerShow.ts';
import type { DrizzleDBAccess } from './schema/index.ts';
import { libraryReferenceRevision } from './libraryReferenceRevision.ts';

export type LibraryEntityKind =
  | 'fillerLists'
  | 'customShows'
  | 'smartCollections';
type References = Record<LibraryEntityKind, LibraryUsedBy>;

@injectable()
export class LibraryUsageService {
  private cached?: { revision: number; promise: Promise<References> };

  constructor(
    @inject(KEYS.DrizzleDB) private db: DrizzleDBAccess,
    @inject(KEYS.LineupRepository) private lineups: LineupRepository,
  ) {}

  async getUsedBy(kind: LibraryEntityKind): Promise<LibraryUsedBy> {
    for (;;) {
      const revision = libraryReferenceRevision();
      if (this.cached?.revision !== revision) {
        this.cached = { revision, promise: this.scan() };
      }
      const cached = this.cached;
      try {
        const references = await cached.promise;
        // A save during the scan must not publish or cache the old result.
        if (revision === libraryReferenceRevision()) return references[kind];
      } catch (error) {
        if (this.cached === cached) this.cached = undefined;
        throw error;
      }
    }
  }

  private async scan(): Promise<References> {
    const references: References = {
      fillerLists: {},
      customShows: {},
      smartCollections: {},
    };
    const channels = this.db.select().from(Channel).all();
    const attachments = this.db.select().from(ChannelFillerShow).all();
    for (const channel of channels) {
      const add = (
        kind: LibraryEntityKind,
        id: string | undefined,
        slot?: number,
      ) => {
        if (id === undefined) return;
        const uses = (references[kind][id] ??= []);
        let use = uses.find((use) => use.id === channel.uuid);
        if (use === undefined) {
          use = {
            id: channel.uuid,
            name: channel.name,
            number: channel.number,
            slots: [],
          };
          uses.push(use);
        }
        if (slot !== undefined && !use.slots.includes(slot))
          use.slots.push(slot);
      };
      for (const attachment of attachments) {
        if (attachment.channelUuid === channel.uuid)
          add('fillerLists', attachment.fillerShowUuid);
      }
      add('fillerLists', channel.offline.musicListId);
      const lineup = await this.lineups.loadLineup(channel.uuid);
      for (const item of lineup.items) {
        if (item.type === 'content') {
          add('fillerLists', item.fillerListId);
          add('customShows', item.customShowId);
        } else if (item.type === 'offline') {
          for (const id of item.fillerConfig?.fillerListIds ?? [])
            add('fillerLists', id);
        }
      }
      for (const [index, slot] of (lineup.schedule?.slots ?? []).entries()) {
        if (slot.type === 'custom-show')
          add('customShows', slot.customShowId, index + 1);
        if (slot.type === 'smart-collection')
          add('smartCollections', slot.smartCollectionId, index + 1);
        if (slot.type === 'filler')
          add('fillerLists', slot.fillerListId, index + 1);
        if ('filler' in slot)
          for (const filler of slot.filler ?? [])
            add('fillerLists', filler.fillerListId, index + 1);
      }
    }
    for (const entities of Object.values(references)) {
      for (const channels of Object.values(entities))
        channels.sort(
          (a, b) => a.number - b.number || a.name.localeCompare(b.name),
        );
    }
    return references;
  }
}
