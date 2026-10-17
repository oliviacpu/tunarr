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
    // an average over stray or missing frames, or a loose label
    [23.81, 24000 / 1001],
    ['23.98', 24000 / 1001],
    [30.3, 30],
    [24.4, 24],
  ])('treats %j, within 2%% of a standard rate, as %d', (framerate, rate) => {
    expect(outputFrameRate(framerate)).toEqual({ rate, standard: true });
  });

  test.each([
    // a DVD rip whose frames alternate 1/24 s and 1/30 s apart reported 20
    [20, 30000 / 1001],
    ['20/1', 30000 / 1001],
    [15, 30000 / 1001],
    [14.26, 30000 / 1001],
    [31, 30000 / 1001],
    [48, 60000 / 1001],
    [120, 60000 / 1001],
  ])('gives a source reporting %j, not standard, %d', (framerate, rate) => {
    expect(outputFrameRate(framerate)).toEqual({ rate, standard: false });
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
