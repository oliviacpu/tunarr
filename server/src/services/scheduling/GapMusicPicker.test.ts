import { chooseGapTrack } from './GapMusicPicker.ts';

function track(
  uuid: string,
  overrides: Partial<{ type: string; duration: number; state: string }> = {},
) {
  return { uuid, type: 'track', duration: 200_000, state: 'ok', ...overrides };
}

describe('chooseGapTrack', () => {
  test('returns null for an empty list', () => {
    expect(chooseGapTrack([], new Map())).toBeNull();
  });

  test('prefers tracks never played from this list', () => {
    const tracks = [track('a'), track('b'), track('c')];
    const played = new Map([
      ['a', 1_000],
      ['c', 2_000],
    ]);
    expect(chooseGapTrack(tracks, played)?.uuid).toBe('b');
  });

  test('picks at random among never-played tracks', () => {
    const tracks = [track('a'), track('b'), track('c')];
    expect(chooseGapTrack(tracks, new Map(), () => 0)?.uuid).toBe('a');
    expect(chooseGapTrack(tracks, new Map(), () => 0.99)?.uuid).toBe('c');
  });

  test('otherwise picks the track played longest ago', () => {
    const tracks = [track('a'), track('b'), track('c')];
    const played = new Map([
      ['a', 3_000],
      ['b', 1_000],
      ['c', 2_000],
    ]);
    expect(chooseGapTrack(tracks, played)?.uuid).toBe('b');
  });

  test('ignores anything that is not a playable track', () => {
    const tracks = [
      track('video', { type: 'episode' }),
      track('missing', { state: 'missing' }),
      track('empty', { duration: 0 }),
      track('ok'),
    ];
    expect(chooseGapTrack(tracks, new Map([['ok', 1]]))?.uuid).toBe('ok');
    expect(chooseGapTrack(tracks.slice(0, 3), new Map())).toBeNull();
  });
});
