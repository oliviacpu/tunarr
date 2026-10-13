import { FilterOption } from './FilterOption.ts';

// afade in or out. Start and duration are in milliseconds, relative to the start of the audio input.
export class AudioFadeFilter extends FilterOption {
  constructor(
    private direction: 'in' | 'out',
    private startMs: number,
    private durationMs: number,
  ) {
    super();
  }

  get filter() {
    const seconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);
    return `afade=t=${this.direction}:st=${seconds(this.startMs)}:d=${seconds(this.durationMs)}`;
  }
}
