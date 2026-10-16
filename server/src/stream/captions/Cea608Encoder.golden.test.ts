import type { CaptionAlignment } from '@tunarr/types/schemas';
import type { CaptionCue } from './Cea608Encoder.ts';
import { buildCaptionSchedule, PaddingPair } from './Cea608Encoder.ts';
import {
  NoCaptionsNoticeMs,
  NoCaptionsNoticeText,
  noCaptionsNoticeStartMs,
} from './ProgramCaptions.ts';

// The bytes the encoder sends with its default appearance, pinned before the
// appearance settings were added. Those settings must leave the defaults
// byte for byte as they were, so this snapshot is never updated.

const Alignments: CaptionAlignment[] = [
  'centeredBlock',
  'centeredLines',
  'left',
];
const FrameRates = [15, 24000 / 1001, 30000 / 1001];

function cues(frameRate: number): CaptionCue[] {
  const noticeStart = noCaptionsNoticeStartMs(frameRate);
  return [
    // Under way when the program starts, with time left to show
    { startMs: -800, endMs: 1500, text: 'Already talking' },
    { startMs: 2000, endMs: 4000, text: 'Hello there.' },
    {
      startMs: 4500,
      endMs: 7000,
      text: '<i>Narrator:</i> it was <u>very</u> {\\i1}dark{\\r} out,\nand cold.',
    },
    { startMs: 7500, endMs: 9500, text: '{\\an8}At the top of the screen' },
    { startMs: 9500, endMs: 11000, text: '{\\a6}SSA top, right after' },
    {
      startMs: 11500,
      endMs: 16000,
      text: 'A cue long enough that it has to be wrapped onto more lines than one caption holds, so it is shown in parts.',
    },
    {
      startMs: 16500,
      endMs: 19000,
      text: 'Café ñandú «Ölgemälde» ♪♪ — ¿Sí? “Ça va…”',
    },
    // Back to back: the second replaces the first without a clear
    { startMs: 19500, endMs: 21000, text: 'First of two' },
    { startMs: 21000, endMs: 22500, text: '<u>Second</u> of two' },
    // Too short to load in the gap: shown late
    { startMs: 22550, endMs: 23200, text: 'Quick!' },
    {
      startMs: noticeStart + 24000,
      endMs: noticeStart + 24000 + NoCaptionsNoticeMs,
      text: NoCaptionsNoticeText,
    },
  ];
}

// Non-padding pairs, one line each: the frame slot and the two bytes
function serialize(
  frameRate: number,
  alignment: CaptionAlignment,
  endMs: number | undefined,
): string {
  const firstFrameMs = 0;
  const schedule = buildCaptionSchedule(cues(frameRate), {
    firstFrameMs,
    frameRate,
    endMs,
    layout: { alignment },
  });
  const lines: string[] = [];
  const frames = Math.ceil((32_000 / 1000) * frameRate);
  for (let slot = 0; slot < frames; slot++) {
    const [a, b] = schedule.pairAt(firstFrameMs + (slot * 1000) / frameRate);
    if (a !== PaddingPair[0] || b !== PaddingPair[1]) {
      lines.push(
        `${slot} ${a.toString(16).padStart(2, '0')} ${b.toString(16).padStart(2, '0')}`,
      );
    }
  }
  return lines.join('\n');
}

test('the default appearance sends the same bytes as before appearance settings', async () => {
  const sections: string[] = [];
  for (const frameRate of FrameRates) {
    for (const alignment of Alignments) {
      for (const endMs of [undefined, 20_000]) {
        sections.push(
          `== ${frameRate.toFixed(3)} fps, ${alignment}, end ${endMs ?? 'none'}\n` +
            serialize(frameRate, alignment, endMs),
        );
      }
    }
  }

  await expect(sections.join('\n')).toMatchFileSnapshot(
    '__snapshots__/cea608-defaults.txt',
  );
});
