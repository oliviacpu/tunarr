import { head } from 'lodash-es';
import type { SubtitlesInputSource } from '../input/SubtitlesInputSource.ts';
import type { FrameState } from '../state/FrameState.ts';
import { FrameDataLocation } from '../types.ts';
import { escapeFilterOptionValue } from './escapeFilterValue.ts';
import { FilterOption } from './FilterOption.ts';

export class SubtitleFilter extends FilterOption {
  constructor(private subtitleInputSource: SubtitlesInputSource) {
    super();
  }

  get filter(): string {
    const stream = head(this.subtitleInputSource.streams);
    if (!stream) {
      return '';
    }

    // Named, not positional: a path with '=' after a run of option-name
    // characters would otherwise be read as option=value
    return `subtitles=filename=${escapeFilterOptionValue(this.subtitleInputSource.path)}`;
  }

  nextState(currentState: FrameState): FrameState {
    return currentState.updateFrameLocation(FrameDataLocation.Software);
  }
}
