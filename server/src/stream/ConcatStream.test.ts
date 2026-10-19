import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import type { TranscodeVideoOutputFormat } from '@/db/schema/TranscodeConfig.js';
import type { FFmpegAssistedFactory } from '@/ffmpeg/FFmpegModule.js';
import type { FfmpegStreamFactory } from '@/ffmpeg/FfmpegStreamFactory.js';
import type { FfmpegTranscodeSession } from '@/ffmpeg/FfmpegTrancodeSession.js';
import type * as Globals from '@/globals.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import type { ChannelConcatStreamMode } from '@tunarr/types/schemas';
import { describe, expect, test, vi } from 'vitest';
import { CaptionLanguageStream } from './captions/CaptionLanguageStream.ts';
import { ConcatStream } from './ConcatStream.ts';

vi.mock('@/globals.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Globals>()),
  serverOptions: () => ({ port: 8000 }),
}));

const channelUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeChannel(
  subtitlesEnabled: boolean | null,
  videoFormat: TranscodeVideoOutputFormat,
) {
  return {
    uuid: channelUuid,
    number: 7,
    subtitlesEnabled,
    transcodeConfig: { name: 'Test config', videoFormat },
  } as ChannelOrmWithTranscodeConfig;
}

// The wrapper with the global HDHomeRun closed-captions switch as given: the
// playlist URL it hands ffmpeg, the sink its output goes through, and what it
// logged at info
async function wrap(opts: {
  subtitlesEnabled: boolean | null;
  hdhrClosedCaptions: boolean;
  streamMode?: ChannelConcatStreamMode;
  // The transcode config's video format (H.264 by default)
  videoFormat?: TranscodeVideoOutputFormat;
}) {
  const createConcatSession = vi.fn((_url: string) =>
    Promise.resolve({} as FfmpegTranscodeSession),
  );
  const ffmpegFactory: FFmpegAssistedFactory = () =>
    ({ createConcatSession }) as unknown as FfmpegStreamFactory;
  const info = vi.fn();
  const stream = new ConcatStream(
    makeChannel(opts.subtitlesEnabled, opts.videoFormat ?? 'h264'),
    opts.streamMode ?? 'hls_concat',
    ffmpegFactory,
    opts.hdhrClosedCaptions,
    'eng',
    { info } as unknown as Logger,
  );
  // In ConcatSession's order: the sink, then the session
  const sink = stream.outputSink();
  await stream.createSession();
  const url = createConcatSession.mock.calls[0]?.[0];
  if (url === undefined) {
    throw new Error('The wrapper never started ffmpeg');
  }
  return { url: new URL(url), sink, info };
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

  test('an H.264 channel with subtitles on logs nothing about its video format', async () => {
    const { info } = await wrap({
      subtitlesEnabled: true,
      hdhrClosedCaptions: true,
      videoFormat: 'h264',
    });

    expect(info).not.toHaveBeenCalled();
  });

  // Captions can only be written into H.264 video, and the transcode doesn't
  // try with other formats. The wrapper used to ask for captioned segments
  // anyway: each one was parsed and refused, and the PMT offered a caption
  // track that never carried text.
  describe.each(['hevc', 'mpeg2video'] as const)(
    'with %s output video',
    (videoFormat) => {
      test("gets plain segments and ffmpeg's own PMT", async () => {
        const { url, sink } = await wrap({
          subtitlesEnabled: true,
          hdhrClosedCaptions: true,
          videoFormat,
        });

        expect(url.pathname).toBe(`/stream/channels/${channelUuid}.m3u8`);
        expect(url.searchParams.get('mode')).toBe('hls');
        expect(url.searchParams.get('variant')).toBe('true');
        expect(url.searchParams.has('captions')).toBe(false);
        expect(sink).toBeUndefined();
      });

      test('says why once when the stream starts', async () => {
        const { info } = await wrap({
          subtitlesEnabled: true,
          hdhrClosedCaptions: true,
          videoFormat,
        });

        expect(info).toHaveBeenCalledTimes(1);
        const [message, channelNumber, configName, format] =
          info.mock.calls[0] ?? [];
        expect(message).toContain('closed captions need H.264');
        expect(channelNumber).toBe(7);
        expect(configName).toBe('Test config');
        expect(format).toBe(videoFormat);
      });

      test('logs nothing when captions were not asked for', async () => {
        const switchOff = await wrap({
          subtitlesEnabled: true,
          hdhrClosedCaptions: false,
          videoFormat,
        });
        const subtitlesOff = await wrap({
          subtitlesEnabled: false,
          hdhrClosedCaptions: true,
          videoFormat,
        });

        expect(switchOff.info).not.toHaveBeenCalled();
        expect(subtitlesOff.info).not.toHaveBeenCalled();
      });
    },
  );
});
