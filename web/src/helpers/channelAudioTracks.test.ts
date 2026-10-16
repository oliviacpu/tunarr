import { describe, expect, test } from 'vitest';
import { parseAudioTracks } from './channelAudioTracks.ts';

describe('parseAudioTracks', () => {
  test.each([
    ['eng, jpn', ['eng', 'jpn']],
    ['eng jpn', ['eng', 'jpn']],
    [' ENG ,  Jpn, ', ['eng', 'jpn']],
    ['eng,,jpn', ['eng', 'jpn']],
    ['', []],
    ['  ', []],
  ])('%j -> %j', (text, expected) => {
    expect(parseAudioTracks(text)).toEqual(expected);
  });
});
