type Entry = {
  lines: string[];
  // Discontinuity tags ffmpeg writes before it (en->discont)
  tagsBefore: number;
};

/**
 * The entries ffmpeg's hls muxer lists in one session's `stream.m3u8`, where
 * every program is its own ffmpeg process run with append_list and
 * discont_start. Rendered either as the whole session (hls_list_size 0) or as
 * the window ffmpeg writes with a bounded hls_list_size, from libavformat's
 * hls_window:
 *
 * - #EXT-X-MEDIA-SEQUENCE is the first listed entry's number;
 * - discont_start's header tag is written only while that is 0;
 * - no #EXT-X-DISCONTINUITY-SEQUENCE is written;
 * - an entry's discontinuity tag is written right before it, and leaves the
 *   file with it.
 *
 * Segments are numbered from 0 in the order they are added.
 */
export class FfmpegHlsPlaylist {
  readonly entries: Entry[] = [];
  // Tags for the next segment, written at the end of the file until it comes
  #pendingTags = 0;
  // ffmpeg processes so far. The whole-session file's header keeps a tag
  // for each, as the reader tests' fake playlist does.
  #processes = 1;
  #dateMs: number;

  constructor(
    readonly uriPrefix = '/stream/channels/x/hls/',
    startMs = Date.parse('2026-10-15T17:00:00.000Z'),
    readonly targetDuration = 2,
  ) {
    this.#dateMs = startMs;
  }

  get segmentCount() {
    return this.entries.length;
  }

  segments(count: number, seconds = this.targetDuration) {
    for (let i = 0; i < count; i++) {
      const number = this.entries.length;
      this.entries.push({
        lines: [
          `#EXTINF:${seconds.toFixed(6)},`,
          `#EXT-X-PROGRAM-DATE-TIME:${new Date(this.#dateMs).toISOString()}`,
          `${this.uriPrefix}data${String(number).padStart(6, '0')}.ts`,
        ],
        tagsBefore: this.#pendingTags,
      });
      this.#pendingTags = 0;
      this.#dateMs += seconds * 1000;
    }
    return this;
  }

  /** A discontinuity tag before the next segment */
  discontinuity() {
    this.#pendingTags++;
    return this;
  }

  /** The next program's ffmpeg: its first segment follows a discontinuity */
  newProgram() {
    this.#processes++;
    return this.discontinuity();
  }

  /**
   * The bytes at the end of the file from the last segment's EXTINF line on,
   * the tags written after it included
   */
  lastEntryBytes() {
    const last = this.entries.at(-1);
    if (last === undefined) {
      return 0;
    }
    return (
      last.lines.join('\n').length +
      1 +
      this.#pendingTags * '#EXT-X-DISCONTINUITY\n'.length
    );
  }

  /** What ffmpeg writes with hls_list_size 0: every entry */
  whole() {
    return this.#render(0, this.#processes);
  }

  /** What ffmpeg writes with hls_list_size `size`: the newest `size` entries */
  window(size: number) {
    const first = Math.max(0, this.entries.length - size);
    return first === 0 ? this.whole() : this.#render(first, 0);
  }

  #render(first: number, headerTags: number) {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      `#EXT-X-TARGETDURATION:${this.targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${first}`,
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ];
    for (let i = 0; i < headerTags; i++) {
      lines.push('#EXT-X-DISCONTINUITY');
    }
    for (const entry of this.entries.slice(first)) {
      for (let i = 0; i < entry.tagsBefore; i++) {
        lines.push('#EXT-X-DISCONTINUITY');
      }
      lines.push(...entry.lines);
    }
    for (let i = 0; i < this.#pendingTags; i++) {
      lines.push('#EXT-X-DISCONTINUITY');
    }
    return lines.join('\n') + '\n';
  }
}
