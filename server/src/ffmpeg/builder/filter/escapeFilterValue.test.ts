import { FileStreamSource, HttpStreamSource } from '../../../stream/types.ts';
import { SubtitlesInputSource } from '../input/SubtitlesInputSource.ts';
import { ExternalSubtitleStream, SubtitleMethods } from '../MediaStream.ts';
import { escapeFilterOptionValue } from './escapeFilterValue.ts';
import { SubtitleFilter } from './SubtitleFilter.ts';

// What av_get_token trims (WHITESPACES in libavutil/avstring.c), and what
// av_isspace counts, for a stricter reader
const AvGetTokenWhitespace = ' \n\t\r';
const AvIsSpaceWhitespace = ' \f\n\r\t\v';

// av_get_token from FFmpeg's libavutil/avstring.c, step for step: the reader
// the escaping is written for
function avGetToken(buf: string, term: string, ws = AvGetTokenWhitespace) {
  let p = 0;
  while (p < buf.length && ws.includes(buf[p] ?? '')) {
    p++;
  }
  let out = '';
  let end = 0;
  while (p < buf.length && !term.includes(buf[p] ?? '')) {
    const c = buf[p++] ?? '';
    if (c === '\\' && p < buf.length) {
      out += buf[p++] ?? '';
      end = out.length;
    } else if (c === "'") {
      while (p < buf.length && buf[p] !== "'") {
        out += buf[p++] ?? '';
      }
      if (p < buf.length) {
        p++;
        end = out.length;
      }
    } else {
      out += c;
    }
  }
  while (out.length > end && ws.includes(out.at(-1) ?? '')) {
    out = out.slice(0, -1);
  }
  return { token: out, rest: buf.slice(p) };
}

// What a filtergraph holding just `name=args` hands the filter: the graph
// pass (parse_filter) and then the option pass (av_opt_get_key_value)
function readOptionValue(
  filter: string,
  name: string,
  key: string,
  ws = AvGetTokenWhitespace,
) {
  expect(filter.startsWith(`${name}=`)).toBe(true);
  const graph = avGetToken(filter.slice(name.length + 1), '[],;', ws);
  expect(graph.rest).toBe('');
  expect(graph.token.startsWith(`${key}=`)).toBe(true);
  const option = avGetToken(graph.token.slice(key.length + 1), ':', ws);
  expect(option.rest).toBe('');
  return option.token;
}

const awkward = [
  "/media/tv/Show (1992) {tvdb-1}/Season 2/Show - S02E19 - Kid's Final Test.en.forced.srt",
  '/media/movies/Title: Part 2 (2001)/Title: Part 2.en.srt',
  '/media/a, b; c [d] {e}/f.srt',
  '/media/back\\slash/and\\ space.srt',
  "/media/quote''twice/'.srt",
  '/media/equals=/key=value.srt',
  '/media/percent%{pts}/x.srt',
  '/media/ünïcödé 日本語/字幕.ass',
  '  /leading and trailing spaces/x.srt  ',
  '/media/tab\there/new\nline.srt',
  '\t\r\n/every edge whitespace/x.srt \n\r\t',
  '\f/form feed and vertical tab/x.srt\v',
  'C:\\Users\\viewer\\Videos\\Show\\ep.srt',
  'http://127.0.0.1:8096/Videos/abc/Subtitles/3/0/Stream.srt?api_key=k:v&x=[1]',
  // Upstream's cases (SubtitleFilter.test.ts and SubtitleFilter.local.test.ts)
  "/media/Maggie's Plan/Maggie's_Plan.he.srt",
  '/media/Juliet, Naked/Juliet,_Naked.he.srt',
  '/media/Title: Part; Cut = Final [2026]\\Movie.he.srt',
  "C:\\Movies\\Title's.srt",
  'http://example.test:8096/Title, Name.srt',
  '/media/Ocean’s Eleven/æon Flux 8½ WALL·E.he.srt',
  "/media/It's: A [Test], Really; x=y/Don't, Stop; [Me]: a=b\\c.srt",
];

describe('escapeFilterOptionValue', () => {
  test('matches the two-level example in the FFmpeg filter documentation', () => {
    // https://ffmpeg.org/ffmpeg-filters.html#Notes-on-filtergraph-escaping
    expect(
      escapeFilterOptionValue(
        "this is a 'string': may contain one, or more, special characters",
      ),
    ).toBe(
      "this is a \\\\\\'string\\\\\\'\\\\: may contain one\\, or more\\, special characters",
    );
  });

  test.each(awkward)('FFmpeg reads back exactly %j', (value) => {
    const filter = `subtitles=filename=${escapeFilterOptionValue(value)}`;
    expect(readOptionValue(filter, 'subtitles', 'filename')).toBe(value);
  });

  test.each(awkward)(
    'a reader trimming every av_isspace character reads back exactly %j',
    (value) => {
      const filter = `subtitles=filename=${escapeFilterOptionValue(value)}`;
      expect(
        readOptionValue(filter, 'subtitles', 'filename', AvIsSpaceWhitespace),
      ).toBe(value);
    },
  );

  test('leaves ordinary path characters as they are', () => {
    expect(escapeFilterOptionValue('/media/tv/Show (1992)/a-b_c.d.srt')).toBe(
      '/media/tv/Show (1992)/a-b_c.d.srt',
    );
  });
});

describe('SubtitleFilter', () => {
  function filterFor(path: string, http = false) {
    const source = http
      ? new HttpStreamSource(path)
      : new FileStreamSource(path);
    return new SubtitleFilter(
      new SubtitlesInputSource(
        source,
        [new ExternalSubtitleStream('subrip', SubtitleMethods.Burn)],
        SubtitleMethods.Burn,
      ),
    ).filter;
  }

  test.each(awkward)('burns in the file at %j', (path) => {
    const http = path.startsWith('http');
    expect(
      readOptionValue(filterFor(path, http), 'subtitles', 'filename'),
    ).toBe(path);
  });

  test('a filename with an apostrophe no longer swallows the rest of the graph', () => {
    // The failing case: the quote opened by the apostrophe ran on through
    // the following chains, so FFmpeg reported "No option name near ..."
    const path =
      "/media/tv/Show/Show - S02E19 - Kid's Final Test.en.forced.srt";
    const graph = `[0:0]pad=1920:1080:-1:-1:color=black,${filterFor(path)}[v];[0:1]aresample=48000[a]`;
    const chains = [];
    let rest = graph;
    while (rest.length > 0) {
      const { token, rest: after } = avGetToken(rest, ';');
      chains.push(token);
      rest = after.slice(1);
    }
    expect(chains).toHaveLength(2);
    expect(chains[1]).toBe('[0:1]aresample=48000[a]');
  });
});
