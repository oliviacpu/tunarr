import type { CcPair } from './Cea608Encoder.ts';
import {
  framePts,
  makeTsSegment as segment,
  parseTsSegment as parse,
  videoAccessUnit,
} from '../../testing/captions/MpegTsSegmentFixture.ts';
import { crc32Mpeg2, insertCaptions } from './MpegTsCaptionInserter.ts';

const pairFor = (pts: number): CcPair => [0x80 | pts % 0x7f, 0x81];
const captionSeiFor = (pts: number) => {
  const [a, b] = pairFor(pts);
  return Buffer.from([
    0x06,
    0x04,
    17,
    0xb5,
    0x00,
    0x31,
    0x47,
    0x41,
    0x39,
    0x34,
    0x03,
    0xc2,
    0xff,
    0xfc,
    a,
    b,
    0xfd,
    0x80,
    0x80,
    0xff,
    0x80,
  ]);
};

describe('insertCaptions', () => {
  test("puts one caption SEI with the frame's pair before the first slice of every frame", () => {
    const result = insertCaptions(segment(), {
      pairForPts: pairFor,
      language: 'eng',
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    const { videoPes } = parse(result.segment);
    expect(result.framesCaptioned).toBe(3);
    expect(videoPes).toHaveLength(3);
    videoPes.forEach((data, k) => {
      const sei = data.indexOf(captionSeiFor(framePts(k)));
      const slice = data.indexOf(Buffer.from([0, 0, 1, k === 0 ? 0x65 : 0x41]));
      expect(sei).toBeGreaterThan(0);
      expect(sei).toBeLessThan(slice);
      // The rest of the access unit is unchanged
      expect(data.subarray(slice)).toEqual(
        videoAccessUnit(k === 0).subarray(
          videoAccessUnit(k === 0).indexOf(
            Buffer.from([0, 0, 1, k === 0 ? 0x65 : 0x41]),
          ),
        ),
      );
    });
  });

  test('keeps whole TS packets, continuous counters and the first PCR', () => {
    const input = segment();
    const result = insertCaptions(input, {
      pairForPts: pairFor,
      language: 'eng',
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    expect(result.segment.length % 188).toBe(0);
    for (let offset = 0; offset < result.segment.length; offset += 188) {
      expect(result.segment.readUInt8(offset)).toBe(0x47);
    }
    const { videoCcs, firstVideoAdaptation } = parse(result.segment);
    expect(videoCcs[0]).toBe(5);
    videoCcs.forEach((cc, i) => {
      if (i > 0) {
        expect(cc).toBe(((videoCcs[i - 1] ?? 0) + 1) & 0x0f);
      }
    });
    expect(firstVideoAdaptation).toEqual(parse(input).firstVideoAdaptation);
  });

  test("names the captions' language in the PMT, with a valid CRC", () => {
    const result = insertCaptions(segment(), {
      pairForPts: pairFor,
      language: 'eng',
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    const { pmtPacket } = parse(result.segment);
    if (!pmtPacket) {
      throw new Error('no PMT');
    }
    const sectionLength =
      ((pmtPacket.readUInt8(6) & 0x0f) << 8) | pmtPacket.readUInt8(7);
    const section = pmtPacket.subarray(5, 5 + 3 + sectionLength);
    expect(crc32Mpeg2(section)).toBe(0);
    expect(
      section.indexOf(Buffer.from([0x86, 7, 0xe1, ...Buffer.from('eng')])),
    ).toBeGreaterThan(0);
  });

  test('leaves video that already carries captions alone', () => {
    const existingCaptions = [
      0,
      0,
      0,
      1,
      0x06,
      0x04,
      0x0b,
      0xb5,
      0x00,
      0x31,
      ...Buffer.from('GA94'),
      0x03,
      0xc1,
      0xff,
      0x80,
    ];
    const result = insertCaptions(segment({ extraNals: existingCaptions }), {
      pairForPts: pairFor,
      language: 'eng',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'the video already carries captions',
    });
  });

  test('only handles H.264 video', () => {
    const result = insertCaptions(segment({ videoStreamType: 0x24 }), {
      pairForPts: pairFor,
      language: 'eng',
    });

    expect(result.ok).toBe(false);
  });

  test("rejects data that isn't whole TS packets", () => {
    const result = insertCaptions(segment().subarray(0, 300), {
      pairForPts: pairFor,
      language: 'eng',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'not a whole number of TS packets',
    });
  });
});
