import { once } from 'node:events';
import {
  RedactSecretsStream,
  TruncatedLineMarker,
  redactErrorSecrets,
  redactSecrets,
} from './redactSecrets.ts';

// Made-up tokens: none of these is a real credential.
const PlexUrl =
  'http://media.example:32400/library/parts/1/file.mkv?X-Plex-Token=abc123';
const EmbyUrl =
  'http://media.example:8096/Videos/1/stream?X-Emby-Token=def456&static=true';

describe('redactSecrets', () => {
  test.each([
    [
      'Plex query token',
      'GET /a?X-Plex-Token=abc123&b=1',
      'GET /a?X-Plex-Token=REDACTED&b=1',
    ],
    ['Plex header', 'X-Plex-Token: abc123', 'X-Plex-Token: REDACTED'],
    [
      'Emby query token',
      '/stream?X-Emby-Token=def456&static=true',
      '/stream?X-Emby-Token=REDACTED&static=true',
    ],
    [
      'Emby header as an ffmpeg -headers argument',
      "-headers 'X-Emby-Token: def456'",
      "-headers 'X-Emby-Token: REDACTED'",
    ],
    [
      'Jellyfin/Emby api_key',
      '/Subtitles/0/Stream.srt?api_key=ghi789',
      '/Subtitles/0/Stream.srt?api_key=REDACTED',
    ],
    [
      'quoted query value',
      '/Items?api_key="k:v;tail"',
      '/Items?api_key="REDACTED"',
    ],
    [
      'single quoted query value',
      "/Items?api_key='k:v;tail'",
      "/Items?api_key='REDACTED'",
    ],
    ['Jellyfin ApiKey', '/Items?ApiKey=ghi789', '/Items?ApiKey=REDACTED'],
    [
      'bare token query parameter',
      'http://h/live.m3u8?token=jkl012',
      'http://h/live.m3u8?token=REDACTED',
    ],
    [
      'Plex header with a quoted value',
      "X-Plex-Token: 'abc123'",
      "X-Plex-Token: 'REDACTED'",
    ],
    [
      'headers dumped as JSON',
      '{"X-Emby-Token": "def456", "X-Plex-Token":"abc123"}',
      '{"X-Emby-Token": "REDACTED", "X-Plex-Token":"REDACTED"}',
    ],
    [
      'MediaBrowser Authorization header',
      'Authorization: MediaBrowser Token="mno345", Client="Tunarr"',
      'Authorization: MediaBrowser Token="REDACTED", Client="Tunarr"',
    ],
  ])('%s', (_name, input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  test('ignores case in the key, as the servers do', () => {
    expect(
      redactSecrets('?x-plex-token=abc123&X-EMBY-TOKEN=def456&API_KEY=ghi789'),
    ).toBe('?x-plex-token=REDACTED&X-EMBY-TOKEN=REDACTED&API_KEY=REDACTED');
    expect(redactSecrets('x-emby-token:def456')).toBe('x-emby-token:REDACTED');
  });

  test('redacts every occurrence', () => {
    const text = `${PlexUrl} ${PlexUrl}\n${EmbyUrl}`;
    const redacted = redactSecrets(text);
    expect(redacted.match(/REDACTED/g)).toHaveLength(3);
    expect(redacted).not.toMatch(/abc123|def456/);
  });

  test('redacts ffmpeg stderr lines that print the input URL', () => {
    const stderr = [
      `Input #0, matroska,webm, from '${PlexUrl}':`,
      `[http @ 0x5581d8c0] HTTP error 401 Unauthorized`,
      `${EmbyUrl}: Server returned 401 Unauthorized (authorization failed)`,
      `[in#0 @ 0x5581d8c0] Error opening input: Server returned 401 Unauthorized`,
    ].join('\n');

    expect(redactSecrets(stderr)).toBe(
      [
        `Input #0, matroska,webm, from 'http://media.example:32400/library/parts/1/file.mkv?X-Plex-Token=REDACTED':`,
        `[http @ 0x5581d8c0] HTTP error 401 Unauthorized`,
        `http://media.example:8096/Videos/1/stream?X-Emby-Token=REDACTED&static=true: Server returned 401 Unauthorized (authorization failed)`,
        `[in#0 @ 0x5581d8c0] Error opening input: Server returned 401 Unauthorized`,
      ].join('\n'),
    );
  });

  test('hides a value with unexpected characters whole', () => {
    expect(redactSecrets('?X-Plex-Token=a.b~c%2Bd/e+f=g&x=1')).toBe(
      '?X-Plex-Token=REDACTED&x=1',
    );
  });

  test.each([
    'X-Plex-Token',
    'X-Emby-Token',
    'X-MediaBrowser-Token',
    'api_key',
    'ApiKey',
    'token',
  ])('redacts punctuation throughout a %s query credential', (key) => {
    const url = `http://media.example/stream?${key}=k:v;tail,(part)<end>'suffix%26encoded&static=true#fragment`;
    expect(redactSecrets(url)).toBe(
      `http://media.example/stream?${key}=REDACTED&static=true#fragment`,
    );
  });

  test('redacts punctuation in quoted stderr URLs and command arguments', () => {
    const url = 'http://media.example/stream?api_key=k:v;tail,(part)';
    expect(redactSecrets(`Input #0 from '${url}':\n-i "${url}"`)).toBe(
      `Input #0 from 'http://media.example/stream?api_key=REDACTED':\n-i "http://media.example/stream?api_key=REDACTED"`,
    );
  });

  test.each([
    ["X-Plex-Token: prefix'suffix", 'X-Plex-Token: REDACTED'],
    ['X-Plex-Token: prefix"suffix', 'X-Plex-Token: REDACTED'],
    [
      "X-Plex-Token: prefix'with\"both'suffix next",
      'X-Plex-Token: REDACTED next',
    ],
    ['X-Plex-Token: k:v;tail,(part)&more#end', 'X-Plex-Token: REDACTED'],
    ['X-Emby-Token: "k:v;tail,(part)&more#end"', 'X-Emby-Token: "REDACTED"'],
    [
      'Authorization: MediaBrowser Token="k:v;tail,(part)", Client="Tunarr"',
      'Authorization: MediaBrowser Token="REDACTED", Client="Tunarr"',
    ],
  ])('redacts header punctuation in %s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  test('leaves text without secrets unchanged', () => {
    const text = [
      'ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers',
      "Input #0, mpegts, from '/media/Show/S01E01.mkv':",
      '  Stream #0:0: Video: h264 (High), yuv420p(tv), 1920x1080, 23.98 fps',
      "[Parsed_drawtext_0 @ 0x1] text='key=value' fontsize=20",
      'frame=  100 fps= 25 q=28.0 size=    1024kB time=00:00:04.00 speed=1.0x',
      'Invalid token in expression; tokens=3; apikey missing; X-Plex-Token=',
      '-hls_key_info_file keyinfo -metadata title=Token',
    ].join('\r\n');

    expect(redactSecrets(text)).toBe(text);
  });

  test('is idempotent', () => {
    const once = redactSecrets(PlexUrl);
    expect(redactSecrets(once)).toBe(once);
  });
});

describe('redactErrorSecrets', () => {
  test('redacts the message, stack, cmd and spawnargs', () => {
    const error = Object.assign(
      new Error(`Command failed: ffprobe ${PlexUrl}\n${PlexUrl}: 401`),
      {
        cmd: `ffprobe ${PlexUrl}`,
        spawnargs: ['-i', EmbyUrl, 42],
        code: 1,
      },
    );

    const redacted = redactErrorSecrets(error);

    expect(redacted).toBe(error);
    expect(error.message).toContain('X-Plex-Token=REDACTED');
    expect(error.stack).toContain('X-Plex-Token=REDACTED');
    expect(error.cmd).toBe(
      'ffprobe http://media.example:32400/library/parts/1/file.mkv?X-Plex-Token=REDACTED',
    );
    expect(error.spawnargs).toEqual([
      '-i',
      'http://media.example:8096/Videos/1/stream?X-Emby-Token=REDACTED&static=true',
      42,
    ]);
    expect(error.code).toBe(1);
    expect(
      JSON.stringify([error.message, error.stack, error.cmd, error.spawnargs]),
    ).not.toMatch(/abc123|def456/);
  });
});

async function streamThrough(
  chunks: Array<string | Buffer>,
): Promise<{ output: string; pushes: string[] }> {
  const stream = new RedactSecretsStream();
  const pushes: string[] = [];
  stream.on('data', (chunk: Buffer) => pushes.push(chunk.toString('utf8')));
  const ended = once(stream, 'end');
  for (const chunk of chunks) {
    stream.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  stream.end();
  await ended;
  return { output: pushes.join(''), pushes };
}

describe('RedactSecretsStream', () => {
  test('redacts a key split across two chunks', async () => {
    const { output } = await streamThrough([
      "Input #0, mpegts, from 'http://h:32400/a?X-Plex-To",
      "ken=abc123':\nnext line\n",
    ]);

    expect(output).toBe(
      "Input #0, mpegts, from 'http://h:32400/a?X-Plex-Token=REDACTED':\nnext line\n",
    );
  });

  test('redacts a value split across chunks', async () => {
    const { output } = await streamThrough([
      'GET /stream?X-Emby-Token=de',
      'f4',
      '56&static=true\n',
    ]);

    expect(output).toBe('GET /stream?X-Emby-Token=REDACTED&static=true\n');
  });

  test('redacts punctuation and apostrophes across stderr chunks', async () => {
    const { output } = await streamThrough([
      "Input #0 from 'http://h/stream?api_key=k:",
      "v;tail,(part)'suffix",
      "':\n",
    ]);
    expect(output).toBe("Input #0 from 'http://h/stream?api_key=REDACTED':\n");
  });

  test('passes finished lines on at once and holds only the unfinished one', async () => {
    const stream = new RedactSecretsStream();
    const pushes: string[] = [];
    stream.on('data', (chunk: Buffer) => pushes.push(chunk.toString('utf8')));

    stream.write(Buffer.from('frame=1\rframe=2\r'));
    stream.write(Buffer.from('done\nOpening http://h/?api_key=gh'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(pushes.join('')).toBe('frame=1\rframe=2\rdone\n');

    const ended = once(stream, 'end');
    stream.end(Buffer.from('i789'));
    await ended;
    expect(pushes.join('')).toBe(
      'frame=1\rframe=2\rdone\nOpening http://h/?api_key=REDACTED',
    );
  });

  test('keeps a multi-byte character split across chunks', async () => {
    const bytes = Buffer.from('Opening /media/Café/a.mkv\n');
    const split = bytes.indexOf(0xa9); // second byte of é
    const { output } = await streamThrough([
      bytes.subarray(0, split),
      bytes.subarray(split),
    ]);

    expect(output).toBe('Opening /media/Café/a.mkv\n');
  });

  test('truncates an overlong line, so a secret it cuts cannot leak', async () => {
    const filler = 'x'.repeat(64 * 1024 + 10);
    const spaces = ' '.repeat(100);
    const { output, pushes } = await streamThrough([
      // The cut falls inside a long value that runs on into the next chunk.
      `${filler} ?X-Plex-Token=${'v'.repeat(100)}`,
      'vv23&next=1 more',
      ' text\nnext line ?X-Emby-To',
      'ken=def456\n',
      // The cut falls between a header key and its value.
      `${filler} X-Emby-Token:${spaces}`,
      'ghi789 rest\nafter\n',
    ]);

    // The overlong line went out before its line break arrived.
    expect(pushes[0]).toBe(
      `${filler} ?X-Plex-Token=REDACTED${TruncatedLineMarker}`,
    );
    expect(output).toBe(
      `${filler} ?X-Plex-Token=REDACTED${TruncatedLineMarker}\n` +
        'next line ?X-Emby-Token=REDACTED\n' +
        `${filler} X-Emby-Token:${spaces}${TruncatedLineMarker}\n` +
        'after\n',
    );
    expect(output).not.toMatch(/def456|ghi789|v23/);
  });

  test('gives the unfinished line, redacted, before the stream ends', async () => {
    const stream = new RedactSecretsStream();
    stream.resume();
    stream.write(Buffer.from('ok\nConversion failed: ?X-Plex-Token=ab'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(stream.heldLine).toBe('Conversion failed: ?X-Plex-Token=REDACTED');
  });

  test('passes text without secrets through unchanged', async () => {
    const text =
      "Input #0, mpegts, from '/media/a.ts':\n  Duration: 00:22:01.00\nframe=  10\r";
    const chunks = text.match(/.{1,7}/gs) ?? [];

    const { output } = await streamThrough(chunks);

    expect(output).toBe(text);
  });
});
