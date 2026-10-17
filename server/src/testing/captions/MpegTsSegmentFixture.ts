import { crc32Mpeg2 } from '../../stream/captions/MpegTsCaptionInserter.ts';

// Builds small MPEG-TS segments shaped like ffmpeg's output: PAT, PMT, then
// H.264 video PES (one access unit each, PCR on the first packet) and audio.

export const VideoPid = 0x100;
export const AudioPid = 0x101;
export const PmtPid = 0x1000;

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

// The 5-byte PES timestamp; PTS is 33 bits, so larger values wrap
function ptsField(unwrapped: number): number[] {
  const pts = unwrapped % 2 ** 33;
  return [
    0x21 | (Math.floor(pts / 2 ** 30) << 1),
    Math.floor(pts / 2 ** 22) & 0xff,
    ((Math.floor(pts / 2 ** 15) & 0x7f) << 1) | 1,
    Math.floor(pts / 2 ** 7) & 0xff,
    ((pts & 0x7f) << 1) | 1,
  ];
}

export function videoAccessUnit(
  idr: boolean,
  extra: number[] = [],
  sliceBytes = 400,
): Buffer {
  const slice = [
    0,
    0,
    0,
    1,
    idr ? 0x65 : 0x41,
    ...Array<number>(sliceBytes).fill(0x55),
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

export type SegmentOptions = {
  videoStreamType?: number;
  extraNals?: number[];
  firstPts?: number;
  // PTS ticks between frames (90 kHz): 3003 is 29.97 fps
  frameStep?: number;
  frames?: number;
  // Continuity counter of the first video packet, to continue an earlier segment
  firstVideoCc?: number;
  // Slice payload per frame; 343 makes a non-IDR frame's PES fill exactly two
  // packets, so any added bytes need a third
  sliceBytes?: number;
  // Each frame's PTS in stream (decode) order, instead of evenly spaced ones:
  // B-frame reordering, or a frame missing
  pts?: number[];
};

export const framePts = (k: number, options: SegmentOptions = {}) =>
  options.pts?.[k] ??
  (options.firstPts ?? 126_000) + k * (options.frameStep ?? 3003);

export function makeTsSegment(options: SegmentOptions = {}): Buffer {
  const parts: Buffer[] = [pat(), pmt(options.videoStreamType)];
  let videoCc = options.firstVideoCc ?? 5;
  for (let k = 0; k < (options.pts?.length ?? options.frames ?? 3); k++) {
    const packets = tsPackets(
      VideoPid,
      pes(
        0xe0,
        framePts(k, options),
        videoAccessUnit(k === 0, options.extraNals, options.sliceBytes),
      ),
      videoCc,
      k === 0,
    );
    videoCc = (videoCc + packets.length) & 0x0f;
    parts.push(...packets);
    parts.push(
      ...tsPackets(
        AudioPid,
        pes(0xc0, framePts(k, options), Buffer.alloc(100, 0x11)),
        k,
        false,
      ),
    );
  }
  return Buffer.concat(parts);
}

// Reads a segment back: video PES payloads, continuity counters, the PMT
export function parseTsSegment(ts: Buffer) {
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
