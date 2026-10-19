import type { TransformCallback } from 'node:stream';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

// Media-server credentials as they appear in URLs, HTTP headers, ffmpeg
// arguments and ffmpeg's own output. Servers read these names without regard
// to case, so the match ignores it too.
const SecretKeys = [
  // Plex and Emby/Jellyfin tokens: query (X-Plex-Token=…) and header
  // (X-Emby-Token: …) forms, also quoted as in a JSON dump of headers.
  String.raw`X-(?:Plex|Emby|MediaBrowser)-Token["']?(?:=|:[ \t]*)`,
  // Jellyfin and Emby query keys: api_key=… and ApiKey=….
  String.raw`api_?key=`,
  // A bare token query parameter.
  String.raw`[?&]token=`,
  // The token in a Jellyfin/Emby "MediaBrowser … Token="…"" Authorization
  // header.
  String.raw`\bToken="`,
];

// A value runs to the next delimiter rather than being a fixed alphabet, so a
// token with unexpected characters is still hidden whole.
const SecretValueChar = String.raw`[^\s"'&#;:,()<>]`;

// $1 is the key, its separator and any opening quote, which stay; the value
// becomes REDACTED.
const SecretPattern = new RegExp(
  `((?:${SecretKeys.join('|')})["']?)${SecretValueChar}+`,
  'gi',
);

/** Replaces each media-server token or API key in `text` with REDACTED. */
export function redactSecrets(text: string): string {
  return text.replace(SecretPattern, '$1REDACTED');
}

/**
 * Redacts, in place, the message, stack and string or string-array
 * properties of an error. Errors from spawning a process carry its command
 * line: `spawnargs` on a failed spawn, `cmd` and the message (with stderr) on a
 * failed `execFile`.
 */
export function redactErrorSecrets<E extends Error>(error: E): E {
  error.message = redactSecrets(error.message);
  if (error.stack !== undefined) {
    error.stack = redactSecrets(error.stack);
  }
  for (const key of Object.keys(error)) {
    const value: unknown = Reflect.get(error, key);
    if (typeof value === 'string') {
      Reflect.set(error, key, redactSecrets(value));
    } else if (Array.isArray(value)) {
      Reflect.set(
        error,
        key,
        value.map((item: unknown) =>
          typeof item === 'string' ? redactSecrets(item) : item,
        ),
      );
    }
  }
  return error;
}

// The longest unfinished line held back while waiting for its line break.
// ffmpeg's lines are far shorter.
const MaxHeldChars = 64 * 1024;

export const TruncatedLineMarker = ' [line truncated]';

/**
 * Redacts secrets from a text stream such as ffmpeg's stderr. A secret can
 * arrive split across two chunks, so the unfinished last line is held back
 * until its line break (a secret never spans lines) or the end of the stream.
 * A line longer than 64 KiB is passed on up to that point and the rest of it
 * dropped, so a secret the cut splits can't leak.
 */
export class RedactSecretsStream extends Transform {
  #decoder = new StringDecoder('utf8');
  #held = '';
  // Dropping the rest of an overlong line, up to its line break.
  #truncating = false;

  /**
   * The unfinished last line, redacted, for a reader that can't wait for the
   * stream to end, such as a dump of stderr when the process exits.
   */
  get heldLine(): string {
    return redactSecrets(this.#held);
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const text = this.#held + this.#untruncated(this.#decoder.write(chunk));
    const lineEnd =
      Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1;
    // A secret never spans the line break between the two parts.
    let out = redactSecrets(text.slice(0, lineEnd));
    this.#held = text.slice(lineEnd);
    if (this.#held.length > MaxHeldChars) {
      out += redactSecrets(this.#held) + TruncatedLineMarker;
      this.#held = '';
      this.#truncating = true;
    }
    if (out.length > 0) {
      this.push(out);
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    const text = this.#held + this.#untruncated(this.#decoder.end());
    this.#held = '';
    if (text.length > 0) {
      this.push(redactSecrets(text));
    }
    callback();
  }

  // `text` without the rest of a line being truncated.
  #untruncated(text: string): string {
    if (!this.#truncating) {
      return text;
    }
    const lineBreak = text.search(/[\r\n]/);
    if (lineBreak === -1) {
      return '';
    }
    this.#truncating = false;
    return text.slice(lineBreak);
  }
}
