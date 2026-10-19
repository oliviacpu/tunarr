import type { Dayjs } from 'dayjs';
import { HlsPlaylistMutator } from '../../stream/hls/HlsPlaylistMutator.ts';
import type {
  HlsPlaylistFilterOptions,
  MutateOptions,
  TrimPlaylistResult,
} from '../../stream/hls/HlsPlaylistMutator.ts';
import { MediaPlaylistIndex } from '../../stream/hls/MediaPlaylistIndex.ts';
import type { PlaylistLine } from '../../stream/hls/MediaPlaylistIndex.ts';

const Discontinuity = { type: 'discontinuity' } as const;

function toLines(
  index: MediaPlaylistIndex,
  endWithDiscontinuity: boolean,
): PlaylistLine[] {
  if (index.discardedCount > 0) {
    throw new Error('This playlist index has discarded segments');
  }
  const items: PlaylistLine[] = [];
  let discontinuities = 0;
  for (const segment of index.segments) {
    while (discontinuities < segment.discontinuitiesBefore) {
      items.push(Discontinuity);
      discontinuities++;
    }
    items.push(segment);
  }
  while (discontinuities < index.discontinuities) {
    items.push(Discontinuity);
    discontinuities++;
  }
  if (endWithDiscontinuity && !index.endsWithDiscontinuity) {
    items.push(Discontinuity);
  }
  return items;
}

export class TestHlsPlaylistMutator extends HlsPlaylistMutator {
  trimPlaylist(
    start: Dayjs,
    filter: HlsPlaylistFilterOptions,
    playlistLines: string[],
    opts: MutateOptions,
  ): TrimPlaylistResult {
    const result = this.trimIndex(
      MediaPlaylistIndex.fromLines(start, playlistLines),
      filter,
      opts,
    );
    if (result === undefined) {
      throw new Error('A playlist parsed whole has no discarded segments');
    }
    return result;
  }

  parsePlaylist(
    start: Dayjs,
    playlistLines: string[],
    endWithDiscontinuity: boolean,
  ): PlaylistLine[] {
    return toLines(
      MediaPlaylistIndex.fromLines(start, playlistLines),
      endWithDiscontinuity,
    );
  }
}
