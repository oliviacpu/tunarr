import type { MediaSourceLibrary } from '@/db/schema/MediaSourceLibrary.js';
import { inject, injectable } from 'inversify';
import type { MediaSource, MediaSourceOrm } from '../db/schema/MediaSource.ts';
import { KEYS } from '../types/inject.ts';
import type { MutexMap } from '../util/mutexMap.ts';

@injectable()
export class EntityMutex {
  constructor(@inject(KEYS.MutexMap) private mutexMap: MutexMap) {}

  async lock(key: string) {
    return this.mutexMap.getOrCreateLock(key);
  }

  async isLocked(key: string) {
    return (await this.lock(key)).isLocked();
  }

  async lockLibrary(library: MediaSourceLibrary) {
    return this.lock(this.libraryKey(library.mediaSourceId, library.uuid));
  }

  isLibraryLocked(library: MediaSourceLibrary) {
    return (
      this.mutexMap
        .getLockSync(this.libraryKey(library.mediaSourceId, library.uuid))
        ?.isLocked() ?? false
    );
  }

  isMediaSourceLocked(mediaSource: MediaSource | MediaSourceOrm) {
    return (
      this.mutexMap
        .getLockSync(this.mediaSourceKey(mediaSource.uuid))
        ?.isLocked() ?? false
    );
  }

  getLockForLibrary(library: MediaSourceLibrary) {
    return this.lock(this.libraryKey(library.mediaSourceId, library.uuid));
  }

  getLockForMediaSource(mediaSource: MediaSource | MediaSourceOrm) {
    return this.lock(this.mediaSourceKey(mediaSource.uuid));
  }

  // Separate from the media source's lock, which marks its libraries locked
  getLockForCollections(mediaSourceId: string) {
    return this.lock(`${this.mediaSourceKey(mediaSourceId)}.collections`);
  }

  // Held while a custom show's sync from its playlist is queued or running
  getLockForCustomShow(customShowId: string) {
    return this.lock(this.customShowKey(customShowId));
  }

  isCustomShowLocked(customShowId: string) {
    return (
      this.mutexMap.getLockSync(this.customShowKey(customShowId))?.isLocked() ??
      false
    );
  }

  customShowKey(customShowId: string) {
    return `custom_show.${customShowId}`;
  }

  libraryKey(mediaSourceId: string, libraryId: string) {
    return `media_source.${mediaSourceId}.library.${libraryId}`;
  }

  mediaSourceKey(mediaSourceId: string) {
    return `media_source.${mediaSourceId}`;
  }
}
