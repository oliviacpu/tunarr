import {
  deinterlacerDoublesFrameRate,
  ffmpegFrameRate,
  outputFrameRate,
} from './outputFrameRate.ts';

describe('outputFrameRate', () => {
  test.each([
    [24, 24],
    ['24000/1001', 24000 / 1001],
    [23.976, 24000 / 1001],
    ['25', 25],
    ['30000/1001', 30000 / 1001],
    [29.97, 30000 / 1001],
    [30, 30],
    [50, 50],
    ['59.94', 60000 / 1001],
    [60, 60],
  ])('keeps the standard rate %j as %d', (framerate, rate) => {
    expect(outputFrameRate(framerate)).toEqual({ rate, standard: true });
  });

  test.each([
    // rounded labels
    ['23.98', 24000 / 1001],
    [60.02, 60],
  ])('treats %j, rounded, as %d', (framerate, rate) => {
    expect(outputFrameRate(framerate)).toEqual({ rate, standard: true });
  });

  test.each([
    // an average over a few missing frames: a correction to give ffmpeg
    [23.81, 24000 / 1001],
    [29.5, 30000 / 1001],
    [59.9, 60000 / 1001],
  ])(
    'corrects %j, up to 2%% below a standard rate, to %d',
    (framerate, rate) => {
      expect(outputFrameRate(framerate)).toEqual({ rate, standard: false });
    },
  );

  test.each([
    // snapping down to 24, 25, 30 or 50 would drop frames
    [24.4, 30000 / 1001],
    [25.5, 30000 / 1001],
    [30.3, 60000 / 1001],
    [50.5, 60000 / 1001],
  ])(
    'keeps every frame of %j, a little above a standard rate: %d',
    (framerate, rate) => {
      expect(outputFrameRate(framerate)).toEqual({ rate, standard: false });
    },
  );

  test.each([
    // a DVD rip whose frames alternate 1/24 s and 1/30 s apart reported 20
    [20, 30000 / 1001],
    ['20/1', 30000 / 1001],
    [15, 30000 / 1001],
    [14.26, 30000 / 1001],
    // a frame rate just above 30's tolerance would lose frames at 29.97
    [31, 60000 / 1001],
    [48, 60000 / 1001],
  ])('gives a source reporting %j, not standard, %d', (framerate, rate) => {
    expect(outputFrameRate(framerate)).toEqual({ rate, standard: false });
  });

  test.each([
    [120, 120],
    [100, 100],
    // just above 60, which snapping down would drop frames from
    [61, 61],
    [60.5, 60.5],
    [119.88, 120000 / 1001],
    ['120000/1001', 120000 / 1001],
  ])('keeps a high-frame-rate source reporting %j as %d', (framerate, rate) => {
    expect(outputFrameRate(framerate)).toEqual({ rate, standard: true });
  });

  test.each([undefined, null, '', 'abc', '0/0', 0, -5, 1000])(
    'has no rate for %j',
    (framerate) => {
      expect(outputFrameRate(framerate)).toBeUndefined();
    },
  );
});

describe('ffmpegFrameRate', () => {
  test.each([
    [24000 / 1001, '24000/1001'],
    [30000 / 1001, '30000/1001'],
    [60000 / 1001, '60000/1001'],
    [24, '24'],
    [25, '25'],
    [30, '30'],
    [23.976, '23.976'],
  ])('writes %d as %s', (rate, text) => {
    expect(ffmpegFrameRate(rate)).toBe(text);
  });
});

describe('deinterlacerDoublesFrameRate', () => {
  test.each([
    ['none', true],
    [undefined, true],
    ['yadif=1', true],
    ['bwdif=1', true],
    ['w3fdif', true],
    ['yadif=0', false],
    ['bwdif=0', false],
  ])('%s doubles the rate: %s', (filter, doubles) => {
    expect(deinterlacerDoublesFrameRate(filter)).toBe(doubles);
  });
});
