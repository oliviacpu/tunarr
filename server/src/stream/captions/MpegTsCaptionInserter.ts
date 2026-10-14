import type { CcPair } from './Cea608Encoder.ts';

// Adds CEA-608 captions to the H.264 video of one MPEG-TS segment: an ATSC A/53
// caption SEI before the first slice of every access unit, and descriptors in
// the PMT that name the captions' language. The video is otherwise untouched;
// only its PES packets are re-split into TS packets.

export const PacketSize = 188;
export const SyncByte = 0x47;
export const PatPid = 0;
const StreamTypeH264 = 0x1b;
const Iso639LanguageDescriptorTag = 0x0a;
const CaptionServiceDescriptorTag = 0x86;
const StartCode = Buffer.from([0, 0, 1]);

export type InsertCaptionsOptions = {
  // The caption pair for the frame shown at this PTS (90 kHz clock)
  pairForPts: (pts90k: number) => CcPair;
  // ISO 639-2 code for the PMT's language descriptors
  language: string;
};

export type InsertCaptionsResult =
  | { ok: true; segment: Buffer; framesCaptioned: number }
  | { ok: false; reason: string };

type TsPacket = {
  offset: number;
  pid: number;
  pusi: boolean;
  hasAdaptation: boolean;
  hasPayload: boolean;
  cc: number;
  payloadStart: number;
};

function readPacket(buf: Buffer, offset: number): TsPacket {
  const pid =
    ((buf.readUInt8(offset + 1) & 0x1f) << 8) | buf.readUInt8(offset + 2);
  const flags = buf.readUInt8(offset + 3);
  const hasAdaptation = (flags & 0x20) !== 0;
  const hasPayload = (flags & 0x10) !== 0;
  return {
    offset,
    pid,
    pusi: (buf.readUInt8(offset + 1) & 0x40) !== 0,
    hasAdaptation,
    hasPayload,
    cc: flags & 0x0f,
    payloadStart:
      offset + 4 + (hasAdaptation ? 1 + buf.readUInt8(offset + 4) : 0),
  };
}

// MPEG-2 CRC-32: polynomial 0x04c11db7, no reflection, no final xor
export function crc32Mpeg2(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
  }
  return crc >>> 0;
}

// The PSI section a packet starts (after its pointer field)
function sectionStart(buf: Buffer, packet: TsPacket): number {
  return packet.payloadStart + 1 + buf.readUInt8(packet.payloadStart);
}

function sectionLength(buf: Buffer, start: number): number {
  return ((buf.readUInt8(start + 1) & 0x0f) << 8) | buf.readUInt8(start + 2);
}

function findPmtPid(buf: Buffer, packets: TsPacket[]): number | undefined {
  const pat = packets.find((p) => p.pid === PatPid && p.pusi);
  if (!pat) {
    return;
  }
  const start = sectionStart(buf, pat);
  const end = start + 3 + sectionLength(buf, start) - 4;
  for (let i = start + 8; i + 4 <= end; i += 4) {
    const programNumber = (buf.readUInt8(i) << 8) | buf.readUInt8(i + 1);
    if (programNumber !== 0) {
      return ((buf.readUInt8(i + 2) & 0x1f) << 8) | buf.readUInt8(i + 3);
    }
  }
  return;
}

// The PMT PID a PAT packet names, when the packet holds a whole PAT section
export function pmtPidOfPat(packet: Buffer): number | undefined {
  const pat = readPacket(packet, 0);
  if (pat.pid !== PatPid || !pat.pusi || !pat.hasPayload) {
    return;
  }
  const start = sectionStart(packet, pat);
  if (
    start + 3 > PacketSize ||
    start + 3 + sectionLength(packet, start) > PacketSize
  ) {
    return;
  }
  return findPmtPid(packet, [pat]);
}

// MPEG-1, MPEG-2, MPEG-4 part 2, H.264, HEVC
const VideoStreamTypes = [0x01, 0x02, 0x10, 0x1b, 0x24];

type VideoEntry = { pid: number; streamType: number };

function findVideo(buf: Buffer, pmt: TsPacket): VideoEntry | undefined {
  const start = sectionStart(buf, pmt);
  const end = start + 3 + sectionLength(buf, start) - 4;
  const programInfoLength =
    ((buf.readUInt8(start + 10) & 0x0f) << 8) | buf.readUInt8(start + 11);
  for (let i = start + 12 + programInfoLength; i + 5 <= end; ) {
    const streamType = buf.readUInt8(i);
    const pid = ((buf.readUInt8(i + 1) & 0x1f) << 8) | buf.readUInt8(i + 2);
    const esInfoLength =
      ((buf.readUInt8(i + 3) & 0x0f) << 8) | buf.readUInt8(i + 4);
    if (VideoStreamTypes.includes(streamType)) {
      return { pid, streamType };
    }
    i += 5 + esInfoLength;
  }
  return;
}

function languageCode(language: string): number[] {
  return [...language.padEnd(3, ' ').slice(0, 3)].map((c) => c.charCodeAt(0));
}

// ISO_639_language_descriptor: ffmpeg-based readers such as Plex take the
// video stream's language from it, and name its embedded captions after it
function iso639LanguageDescriptor(language: string): number[] {
  return [
    Iso639LanguageDescriptorTag,
    4,
    ...languageCode(language),
    0, // audio_type: undefined
  ];
}

// caption_service_descriptor (ATSC A/65): one 608 service on line 21 field 1
function captionServiceDescriptor(language: string): number[] {
  return [
    CaptionServiceDescriptorTag,
    7,
    0xe0 | 1, // reserved bits, number_of_services = 1
    ...languageCode(language),
    0x7e, // digital_cc = 0, reserved, line21_field = 0
    0x3f, // easy_reader = 0, wide_aspect_ratio = 0, reserved
    0xff,
  ];
}

/**
 * A copy of a PMT packet whose video entry names the captions' language: an
 * ISO 639 language descriptor and an ATSC caption service descriptor, each
 * added unless it is already there. Undefined when both are there, the packet
 * starts no PMT section, the section has no video, or the section wouldn't fit
 * in the packet.
 */
export function withLanguageDescriptors(
  pmtPacket: Buffer,
  language: string,
): Buffer | undefined {
  const pmt = readPacket(pmtPacket, 0);
  if (!pmt.pusi || !pmt.hasPayload) {
    return;
  }
  const packet = Buffer.from(pmtPacket.subarray(0, PacketSize));
  const start = sectionStart(packet, pmt);
  // A section that continues in the next packet is left alone
  if (
    start + 12 > PacketSize ||
    start + 3 + sectionLength(packet, start) > PacketSize
  ) {
    return;
  }
  const length = sectionLength(packet, start);
  const end = start + 3 + length - 4;
  const programInfoLength =
    ((packet.readUInt8(start + 10) & 0x0f) << 8) | packet.readUInt8(start + 11);

  for (let i = start + 12 + programInfoLength; i + 5 <= end; ) {
    const streamType = packet.readUInt8(i);
    const esInfoLength =
      ((packet.readUInt8(i + 3) & 0x0f) << 8) | packet.readUInt8(i + 4);
    if (!VideoStreamTypes.includes(streamType)) {
      i += 5 + esInfoLength;
      continue;
    }
    const present = new Set<number>();
    for (
      let d = i + 5;
      d + 2 <= i + 5 + esInfoLength;
      d += 2 + packet.readUInt8(d + 1)
    ) {
      present.add(packet.readUInt8(d));
    }
    const descriptor = [
      ...(present.has(Iso639LanguageDescriptorTag)
        ? []
        : iso639LanguageDescriptor(language)),
      ...(present.has(CaptionServiceDescriptorTag)
        ? []
        : captionServiceDescriptor(language)),
    ];
    if (descriptor.length === 0) {
      return;
    }
    const newEnd = start + 3 + length + descriptor.length;
    if (newEnd > PacketSize) {
      return;
    }
    const insertAt = i + 5 + esInfoLength;
    const section = Buffer.concat([
      packet.subarray(start, insertAt),
      Buffer.from(descriptor),
      packet.subarray(insertAt, end),
    ]);
    const newLength = length + descriptor.length;
    section[1] = (section.readUInt8(1) & 0xf0) | ((newLength >> 8) & 0x0f);
    section[2] = newLength & 0xff;
    const esInfo = esInfoLength + descriptor.length;
    const esOffset = i - start;
    section[esOffset + 3] =
      (section.readUInt8(esOffset + 3) & 0xf0) | (esInfo >> 8);
    section[esOffset + 4] = esInfo & 0xff;
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32Mpeg2(section));
    const out = Buffer.alloc(PacketSize, 0xff);
    packet.copy(out, 0, 0, start);
    section.copy(out, start);
    crc.copy(out, start + section.length);
    return out;
  }
  return;
}

// Annex B emulation prevention for a NAL payload
function escapeNalPayload(bytes: number[]): number[] {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of bytes) {
    if (zeros >= 2 && byte <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return out;
}

// SEI NAL with one user_data_registered_itu_t_t35 message: ATSC A/53 cc_data,
// the 608 pair on field 1 and null padding on field 2
function captionSei(pair: CcPair): Buffer {
  const payload = [
    0xb5, // ITU-T T.35 country code: United States
    0x00,
    0x31, // provider code: ATSC
    0x47,
    0x41,
    0x39,
    0x34, // 'GA94'
    0x03, // user_data_type_code: cc_data
    0xc0 | 2, // process_cc_data_flag, cc_count = 2
    0xff, // em_data
    0xfc,
    pair[0],
    pair[1], // field 1, valid
    0xfd,
    0x80,
    0x80, // field 2, valid, null
    0xff, // marker bits
  ];
  const sei = [0x04, payload.length, ...payload, 0x80];
  return Buffer.from([0, 0, 0, 1, 0x06, ...escapeNalPayload(sei)]);
}

function readPts(pes: Buffer): number | undefined {
  if ((pes.readUInt8(7) & 0x80) === 0) {
    return;
  }
  const b = pes;
  return (
    ((b.readUInt8(9) >> 1) & 0x07) * 2 ** 30 +
    (((b.readUInt8(10) << 8) | b.readUInt8(11)) >> 1) * 2 ** 15 +
    (((b.readUInt8(12) << 8) | b.readUInt8(13)) >> 1)
  );
}

type NalScan = { firstSliceStart?: number; hasA53Captions: boolean };

function scanNals(es: Buffer): NalScan {
  let firstSliceStart: number | undefined;
  let hasA53Captions = false;
  for (let i = 0; i + 3 < es.length; i++) {
    if (es[i] !== 0 || es[i + 1] !== 0 || es[i + 2] !== 1) {
      continue;
    }
    const type = es.readUInt8(i + 3) & 0x1f;
    if ((type === 1 || type === 5) && firstSliceStart === undefined) {
      firstSliceStart = i > 0 && es[i - 1] === 0 ? i - 1 : i;
    }
    if (type === 6) {
      const next = es.indexOf(StartCode, i + 3);
      const ga94 = es.indexOf('GA94', i, 'latin1');
      if (ga94 !== -1 && (next === -1 || ga94 < next)) {
        hasA53Captions = true;
      }
    }
    i += 2;
  }
  return { firstSliceStart, hasA53Captions };
}

// Splits one PES into TS packets, keeping the first packet's adaptation field
// (PCR, random access flag) and stuffing the last one
function packetizePes(
  pes: Buffer,
  pid: number,
  firstAdaptation: Buffer | undefined,
  priorityBit: number,
  // Packets to add beyond the minimum: the PES's last bytes go one per packet
  extraPackets: number = 0,
): Buffer[] {
  const packets: Buffer[] = [];
  const spreadFrom = pes.length - Math.min(extraPackets, pes.length - 1);
  let pos = 0;
  let first = true;
  while (pos < pes.length) {
    const adaptation = first ? firstAdaptation : undefined;
    const room = PacketSize - 4 - (adaptation?.length ?? 0);
    const take = pos >= spreadFrom ? 1 : Math.min(room, spreadFrom - pos);
    const stuffing = room - take;

    let field: Buffer | undefined = adaptation;
    if (stuffing > 0) {
      if (adaptation) {
        field = Buffer.concat([adaptation, Buffer.alloc(stuffing, 0xff)]);
        field[0] = adaptation.readUInt8(0) + stuffing;
      } else if (stuffing === 1) {
        field = Buffer.from([0]);
      } else {
        field = Buffer.alloc(stuffing, 0xff);
        field[0] = stuffing - 1;
        field[1] = 0;
      }
    }

    const packet = Buffer.alloc(PacketSize);
    packet[0] = SyncByte;
    packet[1] = (first ? 0x40 : 0) | priorityBit | ((pid >> 8) & 0x1f);
    packet[2] = pid & 0xff;
    packet[3] = (field ? 0x30 : 0x10) & 0xf0; // continuity counter set later
    let at = 4;
    if (field) {
      field.copy(packet, at);
      at += field.length;
    }
    pes.copy(packet, at, pos, pos + take);
    packets.push(packet);
    pos += take;
    first = false;
  }
  return packets;
}

export function insertCaptions(
  segment: Buffer,
  options: InsertCaptionsOptions,
): InsertCaptionsResult {
  if (segment.length === 0 || segment.length % PacketSize !== 0) {
    return { ok: false, reason: 'not a whole number of TS packets' };
  }
  const packets: TsPacket[] = [];
  for (let offset = 0; offset < segment.length; offset += PacketSize) {
    if (segment[offset] !== SyncByte) {
      return { ok: false, reason: `lost TS sync at byte ${offset}` };
    }
    packets.push(readPacket(segment, offset));
  }

  const pmtPid = findPmtPid(segment, packets);
  const pmt =
    pmtPid === undefined
      ? undefined
      : packets.find((p) => p.pid === pmtPid && p.pusi);
  if (!pmt) {
    return { ok: false, reason: 'no PAT/PMT in the segment' };
  }
  const video = findVideo(segment, pmt);
  if (!video) {
    return { ok: false, reason: 'no video stream in the PMT' };
  }
  if (video.streamType !== StreamTypeH264) {
    return {
      ok: false,
      reason: `video stream type ${video.streamType} is not H.264`,
    };
  }

  // Group the video packets into PES packets
  type Pes = { packetIndexes: number[]; payloadIndexes: number[] };
  const pesList: Pes[] = [];
  for (const [index, packet] of packets.entries()) {
    if (packet.pid !== video.pid) {
      continue;
    }
    if (packet.pusi) {
      pesList.push({ packetIndexes: [], payloadIndexes: [] });
    }
    const current = pesList.at(-1);
    if (!current) {
      continue; // the tail of a PES that began in an earlier segment
    }
    current.packetIndexes.push(index);
    if (packet.hasPayload) {
      current.payloadIndexes.push(index);
    }
  }
  if (pesList.length === 0) {
    return { ok: false, reason: 'no video PES' };
  }
  const packetAt = (index: number): TsPacket => {
    const packet = packets[index];
    if (!packet) {
      throw new Error(`No TS packet ${index}`);
    }
    return packet;
  };

  // Rebuild each PES with its caption SEI
  const rebuilt = new Map<number, Buffer[]>(); // first payload packet index -> packets
  let lastRebuilt:
    | {
        firstIndex: number;
        pes: Buffer;
        adaptation: Buffer | undefined;
        priority: number;
      }
    | undefined;
  let framesCaptioned = 0;
  for (const pes of pesList) {
    const firstIndex = pes.payloadIndexes[0];
    if (firstIndex === undefined) {
      continue;
    }
    const data = Buffer.concat(
      pes.payloadIndexes.map((i) => {
        const p = packetAt(i);
        return segment.subarray(p.payloadStart, p.offset + PacketSize);
      }),
    );
    if (data[0] !== 0 || data[1] !== 0 || data[2] !== 1) {
      return { ok: false, reason: 'video PES without a start code' };
    }
    const headerLength = 9 + data.readUInt8(8);
    const pts = readPts(data);
    if (pts === undefined) {
      return { ok: false, reason: 'video PES without a PTS' };
    }
    const es = data.subarray(headerLength);
    const scan = scanNals(es);
    if (scan.hasA53Captions) {
      return { ok: false, reason: 'the video already carries captions' };
    }
    if (scan.firstSliceStart === undefined) {
      return { ok: false, reason: 'video PES without a slice' };
    }

    const sei = captionSei(options.pairForPts(pts));
    const header = Buffer.from(data.subarray(0, headerLength));
    const pesLength = (header.readUInt8(4) << 8) | header.readUInt8(5);
    if (pesLength !== 0) {
      const newLength = pesLength + sei.length;
      header.writeUInt16BE(newLength <= 0xffff ? newLength : 0, 4);
    }
    const newPes = Buffer.concat([
      header,
      es.subarray(0, scan.firstSliceStart),
      sei,
      es.subarray(scan.firstSliceStart),
    ]);

    const first = packetAt(firstIndex);
    const adaptation = first.hasAdaptation
      ? Buffer.from(
          segment.subarray(
            first.offset + 4,
            first.offset + 5 + segment.readUInt8(first.offset + 4),
          ),
        )
      : undefined;
    const priority = segment.readUInt8(first.offset + 1) & 0x20;
    rebuilt.set(
      firstIndex,
      packetizePes(newPes, video.pid, adaptation, priority),
    );
    lastRebuilt = { firstIndex, pes: newPes, adaptation, priority };
    framesCaptioned++;
  }

  // The segment's video must end on the same continuity counter it did before,
  // so the next segment continues without a jump: a reader that discards
  // corrupt packets (Tunarr's .ts wrapper does) would otherwise drop the frame
  // at every join. Counters run modulo 16, so the last PES gets enough extra
  // packets to keep the payload packet count the same modulo 16.
  const originalPayloadPackets = packets.filter(
    (p) => p.pid === video.pid && p.hasPayload,
  ).length;
  let newPayloadPackets = 0;
  for (const pes of pesList) {
    const first = pes.payloadIndexes[0];
    const replacement = first === undefined ? undefined : rebuilt.get(first);
    newPayloadPackets += replacement?.length ?? pes.payloadIndexes.length;
  }
  const extraPackets =
    (((originalPayloadPackets - newPayloadPackets) % 16) + 16) % 16;
  if (lastRebuilt && extraPackets > 0) {
    rebuilt.set(
      lastRebuilt.firstIndex,
      packetizePes(
        lastRebuilt.pes,
        video.pid,
        lastRebuilt.adaptation,
        lastRebuilt.priority,
        extraPackets,
      ),
    );
  }

  const newPmt = withLanguageDescriptors(
    segment.subarray(pmt.offset, pmt.offset + PacketSize),
    options.language,
  );

  // Write packets in their original order; a PES's new packets take the place
  // of its old ones, any extra right after its last
  const lastPayloadOf = new Map<number, number>(); // last payload index -> first payload index
  const pesOfPayload = new Map<number, number>(); // payload index -> first payload index
  for (const pes of pesList) {
    const first = pes.payloadIndexes[0];
    if (first === undefined) {
      continue;
    }
    for (const i of pes.payloadIndexes) {
      pesOfPayload.set(i, first);
    }
    const last = pes.payloadIndexes.at(-1);
    if (last !== undefined) {
      lastPayloadOf.set(last, first);
    }
  }
  const emitted = new Map<number, number>(); // first payload index -> packets written

  const out: Buffer[] = [];
  // Continuity counters carry on from the segment's first video payload packet;
  // a packet without payload repeats the previous counter
  const firstVideoPayload = packets.find(
    (p) => p.pid === video.pid && p.hasPayload,
  );
  let cc = ((firstVideoPayload?.cc ?? 0) - 1) & 0x0f;
  const writeVideo = (packet: Buffer, hasPayload: boolean) => {
    if (hasPayload) {
      cc = (cc + 1) & 0x0f;
    }
    packet[3] = (packet.readUInt8(3) & 0xf0) | cc;
    out.push(packet);
  };

  for (const [index, packet] of packets.entries()) {
    const raw = segment.subarray(packet.offset, packet.offset + PacketSize);
    if (packet === pmt && newPmt) {
      out.push(newPmt);
      continue;
    }
    if (packet.pid !== video.pid) {
      out.push(raw);
      continue;
    }
    const pesFirst = pesOfPayload.get(index);
    const replacement =
      pesFirst === undefined ? undefined : rebuilt.get(pesFirst);
    if (pesFirst === undefined || !replacement) {
      // Adaptation-only packets, or a PES tail from an earlier segment
      writeVideo(Buffer.from(raw), packet.hasPayload);
      continue;
    }
    const written = emitted.get(pesFirst) ?? 0;
    const isLast = lastPayloadOf.get(index) === pesFirst;
    const upTo = isLast
      ? replacement.length
      : Math.min(written + 1, replacement.length);
    for (const rebuiltPacket of replacement.slice(written, upTo)) {
      writeVideo(rebuiltPacket, true);
    }
    emitted.set(pesFirst, upTo);
  }

  return { ok: true, segment: Buffer.concat(out), framesCaptioned };
}
