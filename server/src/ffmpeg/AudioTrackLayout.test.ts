import type { NonEmptyArray } from 'ts-essentials';
import type { AudioStreamDetails } from '../stream/types.ts';
import { audioTrackSlots, pickSlotAudioStreams } from './AudioTrackLayout.ts';

function track(
  index: number,
  languageCodeISO6392: string | undefined,
  extra: Partial<AudioStreamDetails> = {},
): AudioStreamDetails {
  return { index, codec: 'aac', channels: 2, languageCodeISO6392, ...extra };
}

describe('audioTrackSlots', () => {
  test('keeps valid codes in order, once each, at most four', () => {
    expect(audioTrackSlots(['eng', 'jpn'])).toEqual(['eng', 'jpn']);
    expect(audioTrackSlots(['jpn', 'EN', 'en', 'jpn', 'eng'])).toEqual([
      'jpn',
      'eng',
    ]);
    expect(audioTrackSlots(['eng', 'jpn', 'deu', 'fra', 'spa'])).toEqual([
      'eng',
      'jpn',
      'deu',
      'fra',
    ]);
  });

  test.each([[null], [undefined], [[] as string[]]])('%j is off', (value) => {
    expect(audioTrackSlots(value)).toEqual([]);
  });
});

describe('pickSlotAudioStreams', () => {
  const eng = track(1, 'eng');
  const jpn = track(2, 'jpn');

  test("each slot gets the program's track in its language", () => {
    const streams: NonEmptyArray<AudioStreamDetails> = [eng, jpn];

    expect(pickSlotAudioStreams(['eng', 'jpn'], streams, eng)).toEqual([
      eng,
      jpn,
    ]);
    expect(pickSlotAudioStreams(['jpn', 'eng'], streams, eng)).toEqual([
      jpn,
      eng,
    ]);
  });

  test('a slot whose language the program lacks gets the main track', () => {
    expect(pickSlotAudioStreams(['eng', 'jpn'], [eng], eng)).toEqual([
      eng,
      eng,
    ]);
  });

  test('the main track is kept for its own language, whichever it is', () => {
    // a stream selection profile picked the second English track
    const second = track(3, 'eng', { title: 'Director' });

    expect(pickSlotAudioStreams(['eng'], [eng, second], second)).toEqual([
      second,
    ]);
  });

  test('a commentary track is passed over for its language', () => {
    const commentary = track(2, 'jpn', { title: 'Commentary' });
    const japanese = track(3, 'jpn');

    expect(
      pickSlotAudioStreams(['eng', 'jpn'], [eng, commentary, japanese], eng),
    ).toEqual([eng, japanese]);
  });

  test('among several, the selected then the default track wins', () => {
    const plain = track(2, 'jpn');
    const flagged = track(3, 'jpn', { default: true });
    const selected = track(4, 'jpn', { selected: true });

    expect(
      pickSlotAudioStreams(['jpn'], [eng, plain, flagged, selected], eng),
    ).toEqual([selected]);
    expect(pickSlotAudioStreams(['jpn'], [eng, plain, flagged], eng)).toEqual([
      flagged,
    ]);
  });

  test('the two ISO 639-2 code sets match each other', () => {
    const german = track(2, 'ger');

    expect(pickSlotAudioStreams(['deu'], [eng, german], eng)).toEqual([german]);
  });
});
