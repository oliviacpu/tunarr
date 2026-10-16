import { MaxChannelAudioTracks } from '@tunarr/types/schemas';
import type { NonEmptyArray } from 'ts-essentials';
import type { AudioStreamDetails } from '../stream/types.ts';
import { streamMatchesLanguage } from './StreamSelectionEvaluator.ts';

/**
 * A channel's fixed audio track layout (switchable audio in Plex Live TV,
 * plans/switchable-audio.md). Plex's tuner keeps the audio tracks it saw at
 * tune-in for the whole session and ends it if the stream restarts, so every
 * program, gap and commercial on such a channel outputs exactly these tracks,
 * in this order, each tagged with its slot's language.
 */

/**
 * The channel's slot languages in output order: valid ISO 639-2 codes only,
 * no repeats, at most MaxChannelAudioTracks. Empty = off (one audio track).
 */
export function audioTrackSlots(
  audioTracks: readonly string[] | null | undefined,
): string[] {
  const slots: string[] = [];
  for (const code of audioTracks ?? []) {
    if (
      /^[a-z]{3}$/.test(code) &&
      !slots.includes(code) &&
      slots.length < MaxChannelAudioTracks
    ) {
      slots.push(code);
    }
  }
  return slots;
}

function isCommentary(stream: AudioStreamDetails) {
  return /commentary/i.test(stream.title ?? '');
}

/**
 * The program's audio stream for each slot, in slot order:
 * - the program's main track (the normal selection's pick) when it is already
 *   in the slot's language;
 * - else its track in that language: commentary skipped, then selected,
 *   default, first (as the default selection picks);
 * - else the main track again, so the layout never changes.
 */
export function pickSlotAudioStreams(
  slots: readonly string[],
  audioStreams: NonEmptyArray<AudioStreamDetails>,
  main: AudioStreamDetails,
): AudioStreamDetails[] {
  return slots.map((language) => {
    if (streamMatchesLanguage(main, language)) {
      return main;
    }
    const matches = audioStreams.filter((stream) =>
      streamMatchesLanguage(stream, language),
    );
    const notCommentary = matches.filter((stream) => !isCommentary(stream));
    const candidates = notCommentary.length > 0 ? notCommentary : matches;
    return (
      candidates.find((stream) => stream.selected) ??
      candidates.find((stream) => stream.default) ??
      candidates[0] ??
      main
    );
  });
}
