import { FrameSize } from '../types.ts';
import { FrameState } from '../state/FrameState.ts';
import { Libx265Encoder } from './Libx265Encoder.ts';

test.each([0, 4, 16])(
  'uses the requested x265 thread pool size %i',
  (threads) => {
    const args = new Libx265Encoder(
      new FrameState({
        isAnamorphic: false,
        scaledSize: FrameSize.FHD,
        paddedSize: FrameSize.FHD,
      }),
      'slow',
      threads,
    ).options();
    expect(args[args.indexOf('-x265-params') + 1]).toBe(
      threads ? `log-level=error:pools=${threads}` : 'log-level=error',
    );
    expect(args).toContain('slow');
  },
);
