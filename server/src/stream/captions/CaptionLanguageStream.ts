import type { TransformCallback } from 'node:stream';
import { PassThrough } from 'node:stream';
import {
  PacketSize,
  PatPid,
  SyncByte,
  pmtPidOfPat,
  withLanguageDescriptors,
} from './MpegTsCaptionInserter.ts';

/**
 * Names the captions' language in an MPEG-TS stream by adding language
 * descriptors to the video entry of every PMT (see withLanguageDescriptors).
 *
 * The HDHomeRun .ts stream is ffmpeg's remux of the captioned HLS segments.
 * ffmpeg writes a PMT of its own and drops the segments' descriptors, so Plex
 * listed the captions as "Unknown". Every other byte passes through unchanged;
 * if the stream ever loses TS sync, the rest passes through untouched.
 */
export class CaptionLanguageStream extends PassThrough {
  #pending: Buffer = Buffer.alloc(0);
  #pmtPids = new Set<number>();
  #inSync = true;

  constructor(private language: string) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    if (!this.#inSync) {
      callback(null, chunk);
      return;
    }
    const data =
      this.#pending.length > 0 ? Buffer.concat([this.#pending, chunk]) : chunk;
    const whole = data.length - (data.length % PacketSize);
    const out = Buffer.from(data.subarray(0, whole));
    this.#pending = Buffer.from(data.subarray(whole));

    for (let offset = 0; offset < whole; offset += PacketSize) {
      if (out[offset] !== SyncByte) {
        this.#inSync = false;
        callback(null, Buffer.concat([out, this.#pending]));
        this.#pending = Buffer.alloc(0);
        return;
      }
      const packet = out.subarray(offset, offset + PacketSize);
      const pid = ((packet.readUInt8(1) & 0x1f) << 8) | packet.readUInt8(2);
      if (pid === PatPid) {
        const pmtPid = pmtPidOfPat(packet);
        if (pmtPid !== undefined) {
          this.#pmtPids.add(pmtPid);
        }
      } else if (this.#pmtPids.has(pid)) {
        withLanguageDescriptors(packet, this.language)?.copy(out, offset);
      }
    }
    callback(null, out);
  }

  override _flush(callback: TransformCallback): void {
    callback(null, this.#pending.length > 0 ? this.#pending : undefined);
  }
}
