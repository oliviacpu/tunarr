import { FilterOption } from './FilterOption.ts';

/**
 * Escapes a drawtext option value for a filter graph. ffmpeg unescapes it
 * twice: first the graph parser (where \ ' [ ] , ; are special), then the
 * filter's option parser (where \ ' : are special).
 */
export function escapeDrawtextValue(value: string) {
  return value.replaceAll(/[\\':]/g, '\\$&').replaceAll(/[\\'[\],;]/g, '\\$&');
}

/**
 * Gap music's artist and title, drawn in a dark strip along the bottom of the
 * offline picture. Sized and placed from the picture's own height, before it
 * is scaled to the output, so it lands in the same spot on every channel card:
 * a line a 30th of the height tall, centred across, its middle 94.6% of the way
 * down. That clears the lettering cards put in their lower half, but sits past
 * the 95% title-safe line, so a TV that overscans may crop its lower edge.
 */
export class NowPlayingTextFilter extends FilterOption {
  constructor(
    private text: string,
    private fontFile: string,
  ) {
    super();
  }

  get filter() {
    return [
      `drawtext=fontfile=${escapeDrawtextValue(this.fontFile)}`,
      // the text is shown as is: no %{...} expansion
      'expansion=none',
      `text=${escapeDrawtextValue(this.text)}`,
      'fontsize=h/30',
      'fontcolor=0xF5F0E4',
      'box=1',
      'boxcolor=black@0.6',
      // top and bottom|left and right, in a 1080-line card's pixels
      'boxborderw=14|26',
      'x=(w-text_w)/2',
      // measured from the font's ascent and descent, not this text's, so the
      // strip doesn't move with the letters in it
      'y_align=font',
      'y=h*0.946-font_a/2-font_d/2',
    ].join(':');
  }
}
