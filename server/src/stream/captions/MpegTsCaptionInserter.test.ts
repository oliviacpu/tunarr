import type { CcPair } from './Cea608Encoder.ts';
import {
  framePts,
  makeTsSegment as segment,
  parseTsSegment as parse,
  videoAccessUnit,
} from '../../testing/captions/MpegTsSegmentFixture.ts';
import {
  crc32Mpeg2,
  insertCaptions,
  packetizePes,
} from './MpegTsCaptionInserter.ts';

const pairFor = (pts: number): CcPair => [0x80 | pts % 0x7f, 0x81];
const eachFrame =
  (f: (pts: number) => CcPair) =>
  (pts: readonly number[]): CcPair[] =>
    pts.map(f);
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
      pairsForFrames: eachFrame(pairFor),
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

  test('asks for the pairs once, with every frame in presentation order', () => {
    // Stored in decode order, a B-frame after the frame it precedes
    const pts = [126_000, 132_006, 129_003];
    const asked: (readonly number[])[] = [];
    const result = insertCaptions(segment({ pts }), {
      pairsForFrames: (presented) => {
        asked.push(presented);
        return presented.map(pairFor);
      },
      language: 'eng',
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    expect(asked).toEqual([[126_000, 129_003, 132_006]]);
    // Each frame still carries its own pair
    const { videoPes } = parse(result.segment);
    pts.forEach((p, k) => {
      expect(videoPes[k]?.indexOf(captionSeiFor(p))).toBeGreaterThan(0);
    });
  });

  test('keeps presentation order across the 33-bit PTS wrap', () => {
    // The last frame before the wrap, then two after it, one a B-frame
    const pts = [2 ** 33 - 3003, 3003, 0];
    const asked: (readonly number[])[] = [];
    const result = insertCaptions(segment({ pts }), {
      pairsForFrames: (presented) => {
        asked.push(presented);
        return presented.map(pairFor);
      },
      language: 'eng',
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    expect(asked).toEqual([[2 ** 33 - 3003, 0, 3003]]);
  });

  test('keeps whole TS packets, continuous counters and the first PCR', () => {
    const input = segment();
    const result = insertCaptions(input, {
      pairsForFrames: eachFrame(pairFor),
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

  test('ends on the original continuity counter, so the next segment continues it', () => {
    // A reader that drops corrupt packets (Tunarr's .ts wrapper) would lose the
    // frame at every join if counters jumped between segments
    // Frames that fill their packets exactly, so each caption adds a packet
    const first = segment({ frames: 3, sliceBytes: 343 });
    const firstCcs = parse(first).videoCcs;
    const next = segment({
      frames: 3,
      sliceBytes: 343,
      firstPts: framePts(3),
      firstVideoCc: ((firstCcs.at(-1) ?? 0) + 1) & 0x0f,
    });
    const captionedFirst = insertCaptions(first, {
      pairsForFrames: eachFrame(pairFor),
      language: 'eng',
    });
    const captionedNext = insertCaptions(next, {
      pairsForFrames: eachFrame(pairFor),
      language: 'eng',
    });
    if (!captionedFirst.ok || !captionedNext.ok) {
      throw new Error('not captioned');
    }

    expect(parse(captionedFirst.segment).videoCcs.at(-1)).toBe(firstCcs.at(-1));
    const joined = parse(
      Buffer.concat([captionedFirst.segment, captionedNext.segment]),
    ).videoCcs;
    joined.forEach((cc, i) => {
      if (i > 0) {
        expect(cc).toBe(((joined[i - 1] ?? 0) + 1) & 0x0f);
      }
    });
    // The extra packets carry the frame's last bytes, which still decode
    expect(parse(captionedFirst.segment).videoPes.at(-1)?.at(-1)).toBe(0x55);
  });

  test('ends on the original continuity counter whatever the frame sizes', () => {
    // Spreading the last frame's final bytes one per packet used to remove its
    // last packet when that packet held no more bytes than were spread, so the
    // segment came out one packet short and the next join lost a frame
    for (let sliceBytes = 300; sliceBytes < 700; sliceBytes++) {
      const input = segment({ frames: 3, sliceBytes });
      const result = insertCaptions(input, {
        pairsForFrames: eachFrame(pairFor),
        language: 'eng',
      });
      if (!result.ok) {
        throw new Error(result.reason);
      }
      const original = parse(input);
      const captioned = parse(result.segment);
      expect(captioned.videoCcs.at(-1), `slice of ${sliceBytes} bytes`).toBe(
        original.videoCcs.at(-1),
      );
      expect(captioned.videoPes.map((pes) => pes.at(-1))).toEqual(
        original.videoPes.map((pes) => pes.at(-1)),
      );
    }
  });

  test("names the captions' language in the PMT, with a valid CRC", () => {
    const result = insertCaptions(segment(), {
      pairsForFrames: eachFrame(pairFor),
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
    // The video's own language, which Plex names embedded captions after
    expect(
      section.indexOf(Buffer.from([0x0a, 4, ...Buffer.from('eng'), 0])),
    ).toBeGreaterThan(0);
  });

  test('names the language picked from the frames, given in presentation order', () => {
    // Decode order I P B: P is presented after B
    const pts = [framePts(0), framePts(2), framePts(1)];
    const asked: (readonly number[])[] = [];
    const result = insertCaptions(segment({ pts }), {
      pairsForFrames: eachFrame(pairFor),
      language: (presented) => {
        asked.push(presented);
        return 'jpn';
      },
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    expect(asked).toEqual([[framePts(0), framePts(1), framePts(2)]]);
    const { pmtPacket } = parse(result.segment);
    if (!pmtPacket) {
      throw new Error('no PMT');
    }
    expect(
      pmtPacket.indexOf(Buffer.from([0x0a, 4, ...Buffer.from('jpn'), 0])),
    ).toBeGreaterThan(0);
    expect(
      pmtPacket.indexOf(Buffer.from([0x86, 7, 0xe1, ...Buffer.from('jpn')])),
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
      pairsForFrames: eachFrame(pairFor),
      language: 'eng',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'the video already carries captions',
    });
  });

  test('only handles H.264 video', () => {
    const result = insertCaptions(segment({ videoStreamType: 0x24 }), {
      pairsForFrames: eachFrame(pairFor),
      language: 'eng',
    });

    expect(result.ok).toBe(false);
  });

  test("rejects data that isn't whole TS packets", () => {
    const result = insertCaptions(segment().subarray(0, 300), {
      pairsForFrames: eachFrame(pairFor),
      language: 'eng',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'not a whole number of TS packets',
    });
  });
});

describe('packetizePes', () => {
  // The payload a TS packet carries: after its header and any adaptation field
  const payloadOf = (packet: Buffer) =>
    packet.readUInt8(3) & 0x20
      ? packet.subarray(5 + packet.readUInt8(4))
      : packet.subarray(4);

  test('makes exactly the minimum plus the extra packets, keeping every byte', () => {
    const adaptation = Buffer.from([7, 0x50, 0, 0, 0, 0, 0, 0]);
    const wrong: string[] = [];
    for (const firstAdaptation of [undefined, adaptation]) {
      const firstRoom = 184 - (firstAdaptation?.length ?? 0);
      for (let length = 1; length <= 600; length++) {
        const pes = Buffer.from(
          Array.from({ length }, (_, i) => (i * 7 + 1) & 0xff),
        );
        const minimum =
          length <= firstRoom ? 1 : 1 + Math.ceil((length - firstRoom) / 184);
        for (let extra = 0; extra < 16; extra++) {
          const packets = packetizePes(pes, 0x100, firstAdaptation, 0, extra);
          const name = `${length} bytes, ${extra} extra, adaptation ${!!firstAdaptation}`;
          if (packets.length !== Math.min(minimum + extra, length)) {
            wrong.push(`${name}: ${packets.length} packets`);
          }
          if (!Buffer.concat(packets.map(payloadOf)).equals(pes)) {
            wrong.push(`${name}: bytes changed`);
          }
          if (packets.some((p) => p.length !== 188)) {
            wrong.push(`${name}: a packet isn't 188 bytes`);
          }
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
  });
});
