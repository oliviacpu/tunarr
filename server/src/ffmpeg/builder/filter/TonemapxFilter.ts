import { ColorTransferFormats } from '@/ffmpeg/builder/constants.js';
import { FilterOption } from '@/ffmpeg/builder/filter/FilterOption.js';
import { PixelFormatYuv420P } from '@/ffmpeg/builder/format/PixelFormat.js';
import type { FrameState } from '@/ffmpeg/builder/state/FrameState.js';
import { FrameDataLocation } from '@/ffmpeg/builder/types.js';
import type { TonemapAlgorithm } from '@tunarr/types/schemas';
import { ColorFormat } from '../format/ColorFormat.ts';

/**
 * Software HDR -> SDR tone mapping with jellyfin-ffmpeg's `tonemapx`, a SIMD
 * tone mapper that is much cheaper than the zscale chain in {@link TonemapFilter}.
 * It reads the peak from the frame's HDR10 metadata, applies Dolby Vision RPUs,
 * and drops the HDR10 side data from its output.
 */
export class TonemapxFilter extends FilterOption {
  constructor(
    private currentState: FrameState,
    private algorithm: TonemapAlgorithm,
    // DV Profile 5 may not tag its frames as PQ; tag them so tonemapx reads them as PQ
    private tagInputAsPq: boolean = false,
  ) {
    super();
  }

  public readonly affectsFrameState = true;

  public get filter(): string {
    const tagPq = this.tagInputAsPq
      ? `setparams=color_trc=${ColorTransferFormats.Smpte2084},`
      : '';
    const tonemap = `${tagPq}tonemapx=tonemap=${this.algorithm}:desat=0:t=bt709:m=bt709:p=bt709:r=tv:format=yuv420p`;
    return this.currentState.frameDataLocation === FrameDataLocation.Hardware
      ? `hwdownload,format=p010le|nv12,${tonemap}`
      : tonemap;
  }

  nextState(currentState: FrameState): FrameState {
    return currentState.update({
      colorFormat: ColorFormat.bt709,
      frameDataLocation: FrameDataLocation.Software,
      pixelFormat: new PixelFormatYuv420P(),
    });
  }
}
