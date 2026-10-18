// FFmpeg reads a filter option's value twice, both times with av_get_token:
// first when it splits the filtergraph into filters, where [ ] , ; end a
// filter's arguments, then when it splits those arguments into options, where
// : ends a value. Each pass takes a backslash to mean "the next character is
// literal", treats '...' as a literal run, and drops unescaped whitespace at
// both ends. So a value is escaped for the option pass, and the result again
// for the graph pass.
// https://ffmpeg.org/ffmpeg-filters.html#Notes-on-filtergraph-escaping

const OptionSpecials: ReadonlySet<string> = new Set(['\\', "'", ':']);
const GraphSpecials: ReadonlySet<string> = new Set([
  '\\',
  "'",
  '[',
  ']',
  ',',
  ';',
]);
// av_get_token trims " \n\t\r"; \f and \v too, as av_isspace counts them. An
// escaped character is always read as itself, so escaping extra is harmless.
const Whitespace: ReadonlySet<string> = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '\f',
  '\v',
]);

function escapeOnePass(value: string, specials: ReadonlySet<string>) {
  const chars = [...value];
  const first = chars.findIndex((c) => !Whitespace.has(c));
  const last = chars.findLastIndex((c) => !Whitespace.has(c));
  return chars
    .map((c, i) => {
      // Whitespace before the first or after the last other character would
      // be trimmed
      const atEdge = first === -1 || i < first || i > last;
      return specials.has(c) || (atEdge && Whitespace.has(c)) ? `\\${c}` : c;
    })
    .join('');
}

/**
 * A literal value (a file path, a URL, any text) escaped for one filter
 * option inside a filtergraph, such as the `filename` of `subtitles=filename=`.
 * FFmpeg reads it back exactly, whatever characters it holds.
 */
export function escapeFilterOptionValue(value: string): string {
  return escapeOnePass(escapeOnePass(value, OptionSpecials), GraphSpecials);
}
