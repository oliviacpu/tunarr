import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { FfmpegInfo } from '../src/ffmpeg/ffmpegInfo.ts';
import { Result } from '../src/types/result.ts';
import { getAvailablePort } from '../src/util/net.ts';
import { initTestApp } from './testServer.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = await initTestApp(await getAvailablePort());
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app?.close();
});

function successfulProbes() {
  vi.spyOn(FfmpegInfo.prototype, 'getAvailableAudioEncoders').mockResolvedValue(
    Result.success([{ name: 'AAC', ffmpegName: 'aac' }]),
  );
  vi.spyOn(FfmpegInfo.prototype, 'getAvailableVideoEncoders').mockResolvedValue(
    Result.success([{ name: 'H.264', ffmpegName: 'libx264' }]),
  );
  vi.spyOn(FfmpegInfo.prototype, 'getHwAccels').mockResolvedValue(['vaapi']);
}

describe('GET /ffmpeg-info', () => {
  test('keeps the capability response for successful probes', async () => {
    successfulProbes();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ffmpeg-info',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      audioEncoders: [{ name: 'AAC', ffmpegName: 'aac' }],
      videoEncoders: [{ name: 'H.264', ffmpegName: 'libx264' }],
      hardwareAccelerationTypes: ['vaapi'],
    });
  });

  test.each([
    'getAvailableAudioEncoders',
    'getAvailableVideoEncoders',
  ] as const)('reports a failed %s probe as a server error', async (method) => {
    successfulProbes();
    vi.spyOn(FfmpegInfo.prototype, method).mockResolvedValue(
      Result.forError(new Error('Executable could not run')),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/ffmpeg-info',
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      message: expect.stringContaining('Check the executable path'),
    });
  });

  test('reports an unexpected hardware probe failure with the same error shape', async () => {
    successfulProbes();
    vi.spyOn(FfmpegInfo.prototype, 'getHwAccels').mockRejectedValue(
      new Error('probe failed'),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/ffmpeg-info',
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: expect.any(String) });
  });
});
