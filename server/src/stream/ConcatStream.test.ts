import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import type { FFmpegAssistedFactory } from '@/ffmpeg/FFmpegModule.js';
import type { FfmpegStreamFactory } from '@/ffmpeg/FfmpegStreamFactory.js';
import type { FfmpegTranscodeSession } from '@/ffmpeg/FfmpegTrancodeSession.js';
import type * as Globals from '@/globals.js';
import type { ChannelConcatStreamMode } from '@tunarr/types/schemas';
import { describe, expect, test, vi } from 'vitest';
import { CaptionLanguageStream } from './captions/CaptionLanguageStream.ts';
import { ConcatStream } from './ConcatStream.ts';

vi.mock('@/globals.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Globals>()),
  serverOptions: () => ({ port: 8000 }),
}));

const channelUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeChannel(subtitlesEnabled: boolean | null) {
  return {
    uuid: channelUuid,
    subtitlesEnabled,
    transcodeConfig: {},
  } as ChannelOrmWithTranscodeConfig;
}

// The wrapper with the global HDHomeRun closed-captions switch as given: the
// playlist URL it hands ffmpeg and the sink its output goes through
async function wrap(opts: {
  subtitlesEnabled: boolean | null;
  hdhrClosedCaptions: boolean;
  streamMode?: ChannelConcatStreamMode;
}) {
  const createConcatSession = vi.fn((_url: string) =>
    Promise.resolve({} as FfmpegTranscodeSession),
  );
  const ffmpegFactory: FFmpegAssistedFactory = () =>
    ({ createConcatSession }) as unknown as FfmpegStreamFactory;
  const stream = new ConcatStream(
    makeChannel(opts.subtitlesEnabled),
    opts.streamMode ?? 'hls_concat',
    ffmpegFactory,
    opts.hdhrClosedCaptions,
    'eng',
  );
  await stream.createSession();
  const url = createConcatSession.mock.calls[0]?.[0];
  if (url === undefined) {
    throw new Error('The wrapper never started ffmpeg');
  }
  return { url: new URL(url), sink: stream.outputSink() };
}

describe('ConcatStream captions', () => {
  test("a channel with subtitles off gets plain segments and ffmpeg's own PMT", async () => {
    const { url, sink } = await wrap({
      subtitlesEnabled: false,
      hdhrClosedCaptions: true,
    });

    expect(url.pathname).toBe(`/stream/channels/${channelUuid}.m3u8`);
    expect(url.searchParams.has('captions')).toBe(false);
    expect(sink).toBeUndefined();
  });

  test('a channel whose subtitles were never set is treated as off', async () => {
    const { url, sink } = await wrap({
      subtitlesEnabled: null,
      hdhrClosedCaptions: true,
    });

    expect(url.searchParams.has('captions')).toBe(false);
    expect(sink).toBeUndefined();
  });

  test('a channel with subtitles on asks for captioned segments and relabels the PMT', async () => {
    const { url, sink } = await wrap({
      subtitlesEnabled: true,
      hdhrClosedCaptions: true,
    });

    expect(url.searchParams.get('captions')).toBe('true');
    expect(sink).toBeInstanceOf(CaptionLanguageStream);
  });

  test('with the global switch off, no channel is captioned', async () => {
    const { url, sink } = await wrap({
      subtitlesEnabled: true,
      hdhrClosedCaptions: false,
    });

    expect(url.searchParams.has('captions')).toBe(false);
    expect(sink).toBeUndefined();
  });

  test('the MPEG-TS stream mode is never captioned', async () => {
    const { url, sink } = await wrap({
      subtitlesEnabled: true,
      hdhrClosedCaptions: true,
      streamMode: 'mpegts_concat',
    });

    expect(url.pathname).toBe('/ffmpeg/playlist');
    expect(url.searchParams.has('captions')).toBe(false);
    expect(sink).toBeUndefined();
  });
});
