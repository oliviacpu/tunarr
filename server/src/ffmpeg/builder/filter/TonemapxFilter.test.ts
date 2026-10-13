import {
  ColorPrimaries,
  ColorRanges,
  ColorSpaces,
  ColorTransferFormats,
} from '@/ffmpeg/builder/constants.js';
import { TonemapxFilter } from '@/ffmpeg/builder/filter/TonemapxFilter.js';
import {
  PixelFormatYuv420P,
  PixelFormatYuv420P10Le,
} from '@/ffmpeg/builder/format/PixelFormat.js';
import { FrameState } from '@/ffmpeg/builder/state/FrameState.js';
import { FrameDataLocation, FrameSize } from '@/ffmpeg/builder/types.js';

describe('TonemapxFilter', () => {
  function frameState(frameDataLocation: FrameDataLocation) {
    return new FrameState({
      scaledSize: FrameSize.FHD,
      paddedSize: FrameSize.FHD,
      isAnamorphic: false,
      pixelFormat: new PixelFormatYuv420P10Le(),
      frameDataLocation,
    });
  }

  test.each(['hable', 'bt2390', 'mobius', 'reinhard'] as const)(
    'tone maps to 8-bit bt709 with the %s curve',
    (algorithm) => {
      const filter = new TonemapxFilter(
        frameState(FrameDataLocation.Software),
        algorithm,
      );

      expect(filter.filter).to.eq(
        `tonemapx=tonemap=${algorithm}:desat=0:t=bt709:m=bt709:p=bt709:r=tv:format=yuv420p`,
      );
    },
  );

  test('downloads hardware frames first', () => {
    const filter = new TonemapxFilter(
      frameState(FrameDataLocation.Hardware),
      'hable',
    );

    expect(filter.filter).to.eq(
      'hwdownload,format=p010le|nv12,' +
        'tonemapx=tonemap=hable:desat=0:t=bt709:m=bt709:p=bt709:r=tv:format=yuv420p',
    );
  });

  test('tags the input as PQ when asked (DV Profile 5 without a transfer)', () => {
    const filter = new TonemapxFilter(
      frameState(FrameDataLocation.Software),
      'bt2390',
      true,
    );

    expect(filter.filter).to.eq(
      'setparams=color_trc=smpte2084,' +
        'tonemapx=tonemap=bt2390:desat=0:t=bt709:m=bt709:p=bt709:r=tv:format=yuv420p',
    );
  });

  test('nextState is 8-bit bt709 in software', () => {
    const currentState = frameState(FrameDataLocation.Hardware);
    const nextState = new TonemapxFilter(currentState, 'hable').nextState(
      currentState,
    );

    expect(nextState.frameDataLocation).to.eq(FrameDataLocation.Software);
    expect(nextState.pixelFormat).toMatchPixelFormat(new PixelFormatYuv420P());
    expect(nextState.colorFormat?.colorSpace).to.eq(ColorSpaces.Bt709);
    expect(nextState.colorFormat?.colorTransfer).to.eq(
      ColorTransferFormats.Bt709,
    );
    expect(nextState.colorFormat?.colorPrimaries).to.eq(ColorPrimaries.Bt709);
    expect(nextState.colorFormat?.colorRange).to.eq(ColorRanges.Tv);
  });
});
