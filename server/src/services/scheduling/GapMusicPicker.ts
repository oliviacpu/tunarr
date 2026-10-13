import dayjs from 'dayjs';
import type { IFillerListDB } from '../../db/interfaces/IFillerListDB.ts';
import type { ProgramPlayHistoryDB } from '../../db/ProgramPlayHistoryDB.ts';
import { OpenDateTimeRange } from '../../types/OpenDateTimeRange.ts';

// Plays older than this count as "never played", which keeps the history query small.
const HistoryWindowDays = 30;

type GapTrackCandidate = {
  uuid: string;
  type: string;
  duration: number;
  state: string;
};

/**
 * The next track for a channel's gap music: tracks not played on this channel from this list (within the history
 * window) come first, at random; otherwise the one played longest ago. Only playable tracks count: type track, a
 * positive duration, and not missing from the library.
 */
export function chooseGapTrack<T extends GapTrackCandidate>(
  tracks: readonly T[],
  lastPlayedAt: ReadonlyMap<string, number>,
  random: () => number = Math.random,
): T | null {
  const eligible = tracks.filter(
    (t) => t.type === 'track' && t.duration > 0 && t.state !== 'missing',
  );
  if (eligible.length === 0) {
    return null;
  }

  const neverPlayed = eligible.filter((t) => !lastPlayedAt.has(t.uuid));
  const pool =
    neverPlayed.length > 0
      ? neverPlayed
      : (() => {
          const oldest = Math.min(
            ...eligible.map((t) => lastPlayedAt.get(t.uuid) ?? 0),
          );
          return eligible.filter((t) => lastPlayedAt.get(t.uuid) === oldest);
        })();

  return pool[Math.floor(random() * pool.length)] ?? null;
}

/**
 * Picks the track to play under a channel's offline picture during a gap, from the channel's gap music list
 * (`offline.musicListId`, a filler list). Plays are recorded in program play history with that list's id.
 */
export class GapMusicPicker {
  constructor(
    private fillerDB: IFillerListDB,
    private playHistoryDB: ProgramPlayHistoryDB,
  ) {}

  async pick(channelId: string, musicListId: string, now = dayjs()) {
    const tracks = await this.fillerDB.getFillerPrograms(musicListId);
    const history = await this.playHistoryDB.getFillerHistory(
      channelId,
      OpenDateTimeRange.create(now.subtract(HistoryWindowDays, 'day'), now) ??
        undefined,
    );

    // history is newest first, so the first play seen per track is its latest
    const lastPlayedAt = new Map<string, number>();
    for (const play of history) {
      if (
        play.fillerListId === musicListId &&
        !lastPlayedAt.has(play.programUuid)
      ) {
        lastPlayedAt.set(play.programUuid, play.playedAt.getTime());
      }
    }

    return chooseGapTrack(tracks, lastPlayedAt);
  }
}
