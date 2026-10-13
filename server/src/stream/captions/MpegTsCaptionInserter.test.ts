import type { CcPair } from './Cea608Encoder.ts';
import { crc32Mpeg2, insertCaptions } from './MpegTsCaptionInserter.ts';

// Builds small MPEG-TS segments shaped like ffmpeg's output: PAT, PMT, then
// H.264 video PES (one access unit each, PCR on the first packet) and audio.

const VideoPid = 0x100;
const AudioPid = 0x101;
const PmtPid = 0x1000;

function withCrc(section: number[]): Buffer {
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Mpeg2(Uint8Array.from(section)));
  return Buffer.concat([Buffer.from(section), crc]);
}

function psiPacket(pid: number, section: Buffer): Buffer {
  const packet = Buffer.alloc(188, 0xff);
  packet.set([0x47, 0x40 | (pid >> 8), pid & 0xff, 0x10, 0x00]);
  section.copy(packet, 5);
  return packet;
}

function pat(): Buffer {
  const body = [
    0x00,
    0x01,
    0xc1,
    0x00,
    0x00,
    0x00,
    0x01,
    0xe0 | (PmtPid >> 8),
    PmtPid & 0xff,
  ];
  return psiPacket(0, withCrc([0x00, 0xb0, body.length + 4, ...body]));
}

function pmt(videoStreamType = 0x1b): Buffer {
  const body = [
    0x00,
    0x01,
    0xc1,
    0x00,
    0x00, // program 1, version, sections
    0xe0 | (VideoPid >> 8),
    VideoPid & 0xff, // PCR PID
    0xf0,
    0x00, // program info length 0
    videoStreamType,
    0xe0 | (VideoPid >> 8),
    VideoPid & 0xff,
    0xf0,
    0x00,
    0x0f,
    0xe0 | (AudioPid >> 8),
    AudioPid & 0xff,
    0xf0,
    0x00,
  ];
  return psiPacket(PmtPid, withCrc([0x02, 0xb0, body.length + 4, ...body]));
}

function ptsField(pts: number): number[] {
  return [
    0x21 | (Math.floor(pts / 2 ** 30) << 1),
    Math.floor(pts / 2 ** 22) & 0xff,
    ((Math.floor(pts / 2 ** 15) & 0x7f) << 1) | 1,
    Math.floor(pts / 2 ** 7) & 0xff,
    ((pts & 0x7f) << 1) | 1,
  ];
}

function videoAccessUnit(idr: boolean, extra: number[] = []): Buffer {
  const slice = [
    0,
    0,
    0,
    1,
    idr ? 0x65 : 0x41,
    ...Array<number>(400).fill(0x55),
  ];
  return Buffer.from([
    ...[0, 0, 0, 1, 0x09, 0xf0], // access unit delimiter
    ...(idr ? [0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f] : []), // SPS
    ...extra,
    ...slice,
  ]);
}

function pes(streamId: number, pts: number, es: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 1, streamId, 0, 0, 0x80, 0x80, 5, ...ptsField(pts)]),
    es,
  ]);
}

// TS packets for one PES; the first carries a PCR when asked
function tsPackets(
  pid: number,
  data: Buffer,
  firstCc: number,
  pcr: boolean,
): Buffer[] {
  const packets: Buffer[] = [];
  let pos = 0;
  let cc = firstCc;
  while (pos < data.length) {
    const first = pos === 0;
    const adaptation = first && pcr ? [7, 0x50, 0, 0, 0, 0, 0x7e, 0] : [];
    const room = 184 - adaptation.length;
    const take = Math.min(room, data.length - pos);
    const stuffing = room - take;
    let field = adaptation;
    if (stuffing > 0) {
      field =
        adaptation.length > 0
          ? [
              (adaptation[0] ?? 0) + stuffing,
              ...adaptation.slice(1),
              ...Array<number>(stuffing).fill(0xff),
            ]
          : stuffing === 1
            ? [0]
            : [stuffing - 1, 0, ...Array<number>(stuffing - 2).fill(0xff)];
    }
    const packet = Buffer.alloc(188);
    packet.set([
      0x47,
      (first ? 0x40 : 0) | (pid >> 8),
      pid & 0xff,
      (field.length > 0 ? 0x30 : 0x10) | cc,
    ]);
    packet.set(field, 4);
    data.copy(packet, 4 + field.length, pos, pos + take);
    packets.push(packet);
    pos += take;
    cc = (cc + 1) & 0x0f;
  }
  return packets;
}

const framePts = (k: number) => 126_000 + k * 3003;

function segment(
  options: { videoStreamType?: number; extraNals?: number[] } = {},
) {
  const parts: Buffer[] = [pat(), pmt(options.videoStreamType)];
  let videoCc = 5;
  for (let k = 0; k < 3; k++) {
    const packets = tsPackets(
      VideoPid,
      pes(0xe0, framePts(k), videoAccessUnit(k === 0, options.extraNals)),
      videoCc,
      k === 0,
    );
    videoCc = (videoCc + packets.length) & 0x0f;
    parts.push(...packets);
    parts.push(
      ...tsPackets(
        AudioPid,
        pes(0xc0, framePts(k), Buffer.alloc(100, 0x11)),
        k,
        false,
      ),
    );
  }
  return Buffer.concat(parts);
}

// Reads a segment back: video PES payloads, continuity counters, the PMT
function parse(ts: Buffer) {
  const videoPes: Buffer[] = [];
  const videoCcs: number[] = [];
  let firstVideoAdaptation: Buffer | undefined;
  let pmtPacket: Buffer | undefined;
  for (let offset = 0; offset < ts.length; offset += 188) {
    const packet = ts.subarray(offset, offset + 188);
    const pid = ((packet.readUInt8(1) & 0x1f) << 8) | packet.readUInt8(2);
    const pusi = (packet.readUInt8(1) & 0x40) !== 0;
    const hasAdaptation = (packet.readUInt8(3) & 0x20) !== 0;
    const payloadStart = 4 + (hasAdaptation ? 1 + packet.readUInt8(4) : 0);
    if (pid === PmtPid) {
      pmtPacket = packet;
    }
    if (pid !== VideoPid) {
      continue;
    }
    videoCcs.push(packet.readUInt8(3) & 0x0f);
    if (pusi) {
      if (videoPes.length === 0 && hasAdaptation) {
        firstVideoAdaptation = packet.subarray(4, 5 + packet.readUInt8(4));
      }
      videoPes.push(Buffer.alloc(0));
    }
    const last = videoPes.length - 1;
    videoPes[last] = Buffer.concat([
      videoPes[last] ?? Buffer.alloc(0),
      packet.subarray(payloadStart),
    ]);
  }
  return { videoPes, videoCcs, firstVideoAdaptation, pmtPacket };
}

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
