import type { TransformCallback } from 'node:stream';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

const TokenHeaderKey = String.raw`X-(?:Plex|Emby|MediaBrowser)-Token`;
const QueryKey = String.raw`(?:${TokenHeaderKey}|api_?key|[?&]token)`;

// Query values end at URL delimiters. Punctuation such as commas, colons and
// semicolons can belong to the credential, unlike separators in header dumps.
// A closing ffmpeg quote or the colon before its diagnostic is kept when it
// borders whitespace or the end of the line.
const QueryPattern = new RegExp(
  String.raw`(${QueryKey}=["']?)([^\s&#"]+?)(?='(?=:(?:\s|$)|\s|$)|:(?=\s)|[\s&#"]|$)`,
  'gi',
);

const HeaderPattern = new RegExp(
  String.raw`((?:${TokenHeaderKey}["']?:[ \t]*|\bToken=(?=["'])))(?:("[^"\r\n]*")|('[^'\r\n]*')|([^\s"'][^\s]*?)(?=["'](?:\s|$)|\s|$))`,
  'gi',
);

/** Replaces each media-server token or API key in `text` with REDACTED. */
export function redactSecrets(text: string): string {
  return text
    .replace(QueryPattern, '$1REDACTED')
    .replace(
      HeaderPattern,
      (
        _match,
        key: string,
        doubleQuoted: string | undefined,
        singleQuoted: string | undefined,
      ) => {
        const quote =
          doubleQuoted !== undefined
            ? '"'
            : singleQuoted !== undefined
              ? "'"
              : '';
        return `${key}${quote}REDACTED${quote}`;
      },
    );
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
