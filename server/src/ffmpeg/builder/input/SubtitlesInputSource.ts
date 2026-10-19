import { SubtitleMethods } from '../MediaStream.ts';
import type { SubtitleMethod, SubtitleStream } from '../MediaStream.ts';
import { FrameDataLocation } from '../types.ts';
import type { InputSourceType, StreamSource } from './InputSource.ts';
import { InputSource } from './InputSource.ts';

export class SubtitlesInputSource extends InputSource<SubtitleStream> {
  readonly type: InputSourceType = 'video';
  characterEncoding?: string;

  override getInputOptions(): string[] {
    return [
      ...super.getInputOptions(),
      ...(this.characterEncoding && this.method === SubtitleMethods.Convert
        ? ['-sub_charenc', this.characterEncoding]
        : []),
    ];
  }
  #frameDataLocation: FrameDataLocation = FrameDataLocation.Unknown;

  constructor(
    source: StreamSource,
    public streams: SubtitleStream[],
    public method: SubtitleMethod,
  ) {
    super(source, 'discrete');
  }

  get frameDataLocation() {
    return this.#frameDataLocation;
  }

  set frameDataLocation(location: FrameDataLocation) {
    this.#frameDataLocation = location;
  }
}
