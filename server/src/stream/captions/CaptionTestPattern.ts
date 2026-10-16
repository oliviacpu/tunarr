import type { CaptionAppearance, CaptionCue } from './Cea608Encoder.ts';
import { DefaultCaptionAppearance } from './Cea608Encoder.ts';
import type { ProgramCaptions } from './ProgramCaptions.ts';
import { noCaptionsNoticeStartMs } from './ProgramCaptions.ts';

type Sample = { text: string; appearance?: Partial<CaptionAppearance> };

/**
 * One caption per appearance feature, each saying what it should look like.
 * They're numbered so a viewer can note which ones their player gets wrong.
 * Capitals and line width aren't here: Tunarr applies those to the text
 * before sending it, so every player shows them.
 */
export const CaptionTestSamples: readonly Sample[] = [
  { text: '1 WHITE TEXT' },
  { text: '2 GREEN TEXT', appearance: { textColor: 'green' } },
  { text: '3 BLUE TEXT', appearance: { textColor: 'blue' } },
  { text: '4 CYAN TEXT', appearance: { textColor: 'cyan' } },
  { text: '5 RED TEXT', appearance: { textColor: 'red' } },
  { text: '6 YELLOW TEXT', appearance: { textColor: 'yellow' } },
  { text: '7 MAGENTA TEXT', appearance: { textColor: 'magenta' } },
  // 608's italics are white
  {
    text: '8 RED, <i>WHITE ITALICS,</i> RED',
    appearance: { textColor: 'red' },
  },
  { text: '9 <i>ITALICS</i>' },
  { text: '10 <u>UNDERLINED</u>' },
  { text: '11 BLACK BOX', appearance: { backgroundColor: 'black' } },
  { text: '12 RED BOX', appearance: { backgroundColor: 'red' } },
  { text: '13 GREEN BOX', appearance: { backgroundColor: 'green' } },
  { text: '14 BLUE BOX', appearance: { backgroundColor: 'blue' } },
  { text: '15 CYAN BOX', appearance: { backgroundColor: 'cyan' } },
  { text: '16 MAGENTA BOX', appearance: { backgroundColor: 'magenta' } },
  {
    text: '17 BLUE TEXT, YELLOW BOX',
    appearance: { backgroundColor: 'yellow', textColor: 'blue' },
  },
  {
    text: '18 BLUE TEXT, WHITE BOX',
    appearance: { backgroundColor: 'white', textColor: 'blue' },
  },
  {
    text: '19 SEE-THROUGH BLACK BOX',
    appearance: {
      backgroundColor: 'black',
      backgroundOpacity: 'semiTransparent',
    },
  },
  {
    text: '20 SEE-THROUGH BLUE BOX',
    appearance: {
      backgroundColor: 'blue',
      backgroundOpacity: 'semiTransparent',
    },
  },
  {
    text: '21 NO BOX AT ALL',
    appearance: { backgroundColor: 'black', backgroundOpacity: 'transparent' },
  },
  { text: '{\\an8}22 TOP ROW (1)', appearance: { topRow: 1 } },
  { text: '{\\an8}23 ROW 5', appearance: { topRow: 5 } },
  { text: '24 ROW 11', appearance: { bottomRow: 11 } },
  { text: '25 ROW 13', appearance: { bottomRow: 13 } },
  {
    text: '26 THREE LINES\nSECOND LINE\nTHIRD LINE',
    appearance: { maxLines: 3 },
  },
  {
    text: '27 FOUR LINES\nSECOND LINE\nTHIRD LINE\nFOURTH LINE',
    appearance: { maxLines: 4 },
  },
  { text: '28 LEFT-ALIGNED\nLINES', appearance: { alignment: 'left' } },
  {
    text: '29 EACH LINE\nCENTRED ON ITS OWN',
    appearance: { alignment: 'centeredLines' },
  },
  { text: '30 FLASHING TEXT', appearance: { flash: true } },
  {
    text: '31 PAINT-ON: LETTERS\nAPPEAR AS THEY ARRIVE',
    appearance: { mode: 'paintOn' },
  },
  {
    text: '32 ROLL-UP, 2 ROWS\nLINE TWO\nLINE THREE',
    appearance: { mode: 'rollUp2' },
  },
  {
    text: '33 ROLL-UP, 3 ROWS\nLINE TWO\nLINE THREE\nLINE FOUR',
    appearance: { mode: 'rollUp3' },
  },
  {
    text: '34 ROLL-UP, 4 ROWS\nLINE TWO\nLINE THREE\nLINE FOUR\nLINE FIVE',
    appearance: { mode: 'rollUp4' },
  },
];

// How long each sample shows, and the gap after it: longer around the modes
// that draw as the text arrives, and before a change of mode
const ShownMs = 4000;
const DrawnShownMs = 6000;
const GapMs = 1500;
const ModeChangeGapMs = 2000;

/**
 * The test pattern in place of a program's captions: the samples one after
 * another, from where the no-captions notice would start, looping for as
 * long as the program runs. Each sample carries its whole appearance, so the
 * appearance settings don't change it.
 */
export function captionTestPattern(base: ProgramCaptions): ProgramCaptions {
  const cues: CaptionCue[] = [];
  let at = noCaptionsNoticeStartMs(base.frameRate);
  for (let i = 0; ; i++) {
    const sample = CaptionTestSamples[i % CaptionTestSamples.length];
    if (!sample) {
      break;
    }
    const appearance: CaptionAppearance = {
      ...DefaultCaptionAppearance,
      ...sample.appearance,
    };
    const shown = appearance.mode === 'popOn' ? ShownMs : DrawnShownMs;
    if (at + shown + 1000 > base.durationMs) {
      break;
    }
    cues.push({
      startMs: at,
      endMs: at + shown,
      text: sample.text,
      appearance,
    });

    const next = CaptionTestSamples[(i + 1) % CaptionTestSamples.length];
    const nextMode = next?.appearance?.mode ?? DefaultCaptionAppearance.mode;
    at += shown + (nextMode === appearance.mode ? GapMs : ModeChangeGapMs);
  }
  return { ...base, cues };
}
