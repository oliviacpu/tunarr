import {
  PmtPid,
  VideoPid,
  makeTsSegment as segment,
} from '../../testing/captions/MpegTsSegmentFixture.ts';
import { CaptionLanguageStream } from './CaptionLanguageStream.ts';
import { crc32Mpeg2 } from './MpegTsCaptionInserter.ts';

// Feeds input through the stream in chunks of the given size
async function relabel(input: Buffer, chunkSize: number, language = 'eng') {
  const stream = new CaptionLanguageStream(language);
  const out: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => out.push(chunk));
  const ended = new Promise((resolve) => stream.on('end', resolve));
  for (let i = 0; i < input.length; i += chunkSize) {
    stream.write(input.subarray(i, i + chunkSize));
  }
  stream.end();
  await ended;
  return Buffer.concat(out);
}

const pidOf = (packet: Buffer) =>
  ((packet.readUInt8(1) & 0x1f) << 8) | packet.readUInt8(2);

function packets(ts: Buffer) {
  const list: Buffer[] = [];
  for (let offset = 0; offset < ts.length; offset += 188) {
    list.push(ts.subarray(offset, offset + 188));
  }
  return list;
}

// The descriptors on the PMT's video entry, by tag; checks the section's CRC
function videoDescriptors(pmtPacket: Buffer) {
  const start = 5;
  const length =
    ((pmtPacket.readUInt8(start + 1) & 0x0f) << 8) |
    pmtPacket.readUInt8(start + 2);
  expect(crc32Mpeg2(pmtPacket.subarray(start, start + 3 + length))).toBe(0);
  const programInfoLength =
    ((pmtPacket.readUInt8(start + 10) & 0x0f) << 8) |
    pmtPacket.readUInt8(start + 11);
  const end = start + 3 + length - 4;
  for (let i = start + 12 + programInfoLength; i + 5 <= end; ) {
    const pid =
      ((pmtPacket.readUInt8(i + 1) & 0x1f) << 8) | pmtPacket.readUInt8(i + 2);
    const esInfoLength =
      ((pmtPacket.readUInt8(i + 3) & 0x0f) << 8) | pmtPacket.readUInt8(i + 4);
    if (pid === VideoPid) {
      const descriptors = new Map<number, Buffer>();
      for (let d = i + 5; d < i + 5 + esInfoLength; ) {
        const size = pmtPacket.readUInt8(d + 1);
        descriptors.set(
          pmtPacket.readUInt8(d),
          pmtPacket.subarray(d + 2, d + 2 + size),
        );
        d += 2 + size;
      }
      return descriptors;
    }
    i += 5 + esInfoLength;
  }
  throw new Error('no video entry in the PMT');
}

describe('CaptionLanguageStream', () => {
  // Two segments back to back, as ffmpeg repeats the PAT and PMT
  const input = Buffer.concat([segment(), segment({ firstPts: 900_000 })]);

  test.each([1, 100, 188, 1000, 64 * 1024])(
    "names the captions' language on every PMT's video (chunks of %d bytes)",
    async (chunkSize) => {
      const output = await relabel(input, chunkSize);

      expect(output.length).toBe(input.length);
      const pmts = packets(output).filter((p) => pidOf(p) === PmtPid);
      expect(pmts).toHaveLength(2);
      for (const pmt of pmts) {
        const descriptors = videoDescriptors(pmt);
        expect(descriptors.get(0x0a)).toEqual(
          Buffer.from([...Buffer.from('eng'), 0]),
        );
        expect(descriptors.get(0x86)?.subarray(1, 4).toString()).toBe('eng');
      }
      // Everything else is untouched
      const before = packets(input);
      packets(output).forEach((packet, i) => {
        if (pidOf(packet) !== PmtPid) {
          expect(packet.equals(before[i] ?? Buffer.alloc(0))).toBe(true);
        }
      });
    },
  );

  test('uses the configured language', async () => {
    const output = await relabel(input, 4096, 'spa');
    const pmt = packets(output).find((p) => pidOf(p) === PmtPid);
    if (!pmt) {
      throw new Error('no PMT');
    }
    expect(videoDescriptors(pmt).get(0x0a)?.subarray(0, 3).toString()).toBe(
      'spa',
    );
  });

  test('leaves a PMT that already names the language as it is', async () => {
    const once = await relabel(input, 4096);
    const twice = await relabel(once, 4096);
    expect(twice.equals(once)).toBe(true);
  });

  test('passes a stream it cannot parse through unchanged', async () => {
    const garbage = Buffer.from(
      Array.from({ length: 5000 }, (_, i) => (i * 7) % 256),
    );
    expect((await relabel(garbage, 333)).equals(garbage)).toBe(true);
  });

  test('passes everything through once sync is lost mid-stream', async () => {
    const broken = Buffer.concat([
      input.subarray(0, 188 * 3),
      Buffer.from([1, 2, 3]),
      input.subarray(188 * 3),
    ]);
    const output = await relabel(broken, 500);
    expect(output.length).toBe(broken.length);
    // The packets after the break are as they came in
    expect(output.subarray(188 * 3).equals(broken.subarray(188 * 3))).toBe(
      true,
    );
  });
});
