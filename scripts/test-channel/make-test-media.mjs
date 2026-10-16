#!/usr/bin/env node
/**
 * make-test-media.mjs: labelled test clips for a Tunarr test channel (fork, 2026-10-16; plan in
 * plans/test-channel-99.md). Every clip shows a big label saying what it tests, a running clock and a frame counter,
 * and has motion (testsrc2), so a problem can be reported as "clip 04 at 0:41, frame 1229".
 *
 *   node scripts/test-channel/make-test-media.mjs --out DIR [--ffmpeg PATH] [--ffprobe PATH] [--only 01,04] [--font F]
 *
 * Needs ffmpeg with libx264, libx265, zscale, drawtext and the ac3/eac3/aac encoders (jellyfin-ffmpeg has them), and
 * macOS `say` with the Samantha (English) and Kyoko (Japanese) voices for the spoken audio. Writes `<name>.mkv` plus a
 * sidecar `<name>.en.srt` / `<name>.en.ass` where a clip has subtitles, then probes every clip and writes
 * `manifest.json` with what ffprobe found (tracks, languages, colour tags, HDR side data, field order).
 *
 * The caption clips speak every subtitle line at its start time (macOS `say`), so caption timing can be judged by ear.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ------------------------------------------------------------------ arguments

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = path.resolve(arg('out', 'test-media'));
const FFMPEG = arg('ffmpeg', 'ffmpeg');
const FFPROBE = arg('ffprobe', 'ffprobe');
const SAY = arg('say', 'say');
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const FONT = arg('font', '/System/Library/Fonts/Supplemental/Arial Bold.ttf');
const WORK = path.join(OUT, '.work');

fs.mkdirSync(WORK, { recursive: true });
// a font path without spaces or quotes, so it needs no escaping in the filter graph
const FONTFILE = path.join(WORK, 'label.ttf');
fs.copyFileSync(FONT, FONTFILE);

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed (${r.status}): ${(r.stderr || '').slice(-1500)}`);
  }
  return r.stdout;
}

const ff = (ffArgs) => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...ffArgs]);

// ------------------------------------------------------------------ text helpers

const pad = (n, w = 2) => String(n).padStart(w, '0');
function srtTime(s) {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
function assTime(s) {
  const cs = Math.round(s * 100);
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}
// what `say` should read: no markup, no music notes, ASS line breaks as pauses
function spoken(text) {
  return text
    // an ASS vector drawing ({\p1}m 0 0 l ...{\p0}) is shapes, not words
    .replace(/\{[^}]*\\p[1-9][^}]*\}.*?(\{[^}]*\\p0[^}]*\}|$)/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\N/g, ' ')
    .replace(/[♪]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
// drawtext text goes through a text file, so only the file path needs to be filter-safe
let textFileCount = 0;
function textFile(text) {
  const p = path.join(WORK, `t${++textFileCount}.txt`);
  fs.writeFileSync(p, text);
  return p;
}

// ------------------------------------------------------------------ audio building blocks

const sayCache = new Map();
function sayFile(voice, text) {
  const key = `${voice}|${text}`;
  if (!sayCache.has(key)) {
    const p = path.join(WORK, `say${sayCache.size + 1}.aiff`);
    run(SAY, ['-v', voice, '-o', p, text]);
    sayCache.set(key, p);
  }
  return sayCache.get(key);
}

/** Mono speech: each [startSeconds, text] spoken by `voice`, mixed onto silence, `duration` long. */
function speechTimeline(name, voice, lines, duration, rate = 48000) {
  const out = path.join(WORK, `${name}.wav`);
  const inputs = [];
  const chains = [];
  lines.forEach(([start, text], i) => {
    inputs.push('-i', sayFile(voice, text));
    const ms = Math.round(start * 1000);
    chains.push(`[${i}:a]aresample=${rate},aformat=channel_layouts=mono,adelay=${ms}:all=1[a${i}]`);
  });
  const mix = `${lines.map((_, i) => `[a${i}]`).join('')}amix=inputs=${lines.length}:normalize=0:dropout_transition=0,apad,atrim=0:${duration}[out]`;
  ff([...inputs, '-filter_complex', `${chains.join(';')};${mix}`, '-map', '[out]', '-ar', String(rate), out]);
  return out;
}

/** A short pattern repeated to fill `duration`. */
function loopTo(name, pattern, duration, rate = 48000) {
  const out = path.join(WORK, `${name}.wav`);
  ff(['-stream_loop', '-1', '-i', pattern, '-t', String(duration), '-ar', String(rate), out]);
  return out;
}

/** "This is the English track", every 6 s. */
function languagePattern(lang) {
  const voice = lang === 'jpn' ? 'Kyoko' : 'Samantha';
  const text = lang === 'jpn' ? 'これは日本語のトラックです。トラック二。' : 'This is the English track. Track one.';
  return speechTimeline(`pattern-${lang}`, voice, [[0.5, text]], 6);
}

/** 5.1 speaker check: each speaker names itself in turn, the LFE gets a 50 Hz tone. 16 s pattern, layout 5.1. */
function speakerPattern() {
  const names = ['Front left', 'Front right', 'Centre', null, 'Surround left', 'Surround right'];
  const inputs = [];
  const chains = [];
  names.forEach((name, i) => {
    const ms = i * 2500 + 500;
    // one input per speaker, in order, so input i feeds channel i
    if (name) {
      inputs.push('-i', sayFile('Samantha', name));
      chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms}:all=1,apad,atrim=0:16[c${i}]`);
    } else {
      inputs.push('-f', 'lavfi', '-i', 'sine=frequency=50:sample_rate=48000:duration=1.5');
      chains.push(`[${i}:a]aformat=channel_layouts=mono,volume=0.6,adelay=${ms}:all=1,apad,atrim=0:16[c${i}]`);
    }
  });
  const out = path.join(WORK, 'pattern-51.wav');
  ff([...inputs, '-filter_complex', `${chains.join(';')};${names.map((_, i) => `[c${i}]`).join('')}join=inputs=6:channel_layout=5.1:map=0.0-FL|1.0-FR|2.0-FC|3.0-LFE|4.0-BL|5.0-BR[out]`, '-map', '[out]', out]);
  return out;
}

/** Stereo check: "Left" on the left, "Right" on the right, "Both" on both. 7 s pattern. */
function stereoPattern() {
  const l = sayFile('Samantha', 'Left');
  const r = sayFile('Samantha', 'Right');
  const b = sayFile('Samantha', 'Both sides');
  const out = path.join(WORK, 'pattern-lr.wav');
  ff(['-i', l, '-i', r, '-i', b, '-filter_complex',
    '[0:a]aresample=48000,aformat=channel_layouts=mono,adelay=500,apad,atrim=0:7[l];' +
    '[1:a]aresample=48000,aformat=channel_layouts=mono,adelay=2500,apad,atrim=0:7[r];' +
    '[2:a]aresample=48000,aformat=channel_layouts=mono,adelay=4500,apad,atrim=0:7[b];' +
    '[b]asplit[b1][b2];[l][b1]amix=inputs=2:normalize=0[left];[r][b2]amix=inputs=2:normalize=0[right];' +
    '[left][right]join=inputs=2:channel_layout=stereo[out]', '-map', '[out]', out]);
  return out;
}

// mono speech placed in every channel of a layout (centre-only for 5.1)
function toLayout(wav, layout) {
  if (layout === 'mono') return wav;
  const out = wav.replace(/\.wav$/, `-${layout.replace('.', '')}.wav`);
  const pan = layout === 'stereo' ? 'pan=stereo|c0=c0|c1=c0' : 'pan=5.1|FC=c0|FL=0.3*c0|FR=0.3*c0';
  ff(['-i', wav, '-af', pan, out]);
  return out;
}

// ------------------------------------------------------------------ subtitle suites

// SRT caption cases: [label, [[start, end, text], ...]]. Every case is shown on screen while it plays.
const SRT_CASES = [
  ['CASE 1  plain lines', [
    [0.5, 3.0, 'Good evening, and welcome to the test channel.'],
    [3.4, 6.2, 'Every line here should appear while it is spoken.'],
    [6.6, 9.6, 'If a line is late or early, note the clock.']]],
  ['CASE 2  italics and underline', [
    [10.5, 13.5, '<i>This whole line is in italics.</i>'],
    [14.0, 17.0, 'Only <i>these words</i> lean, and <u>this</u> is underlined.'],
    [17.4, 19.6, '<i>Narrator:</i> mixed styles in one line.']]],
  ['CASE 3  music notes', [
    [20.5, 23.5, '♪ La la la, a song in the background ♪'],
    [24.0, 26.8, '♪♪ Two notes at the start'],
    [27.2, 29.6, 'She hums the tune. ♪']]],
  ['CASE 4  long lines that wrap', [
    [30.5, 35.5, 'This sentence is deliberately long so that it has to wrap onto a second line on screen.'],
    [36.0, 41.6, 'And this one is longer still: it keeps going past the width of a caption row, so it needs two lines and maybe a third.']]],
  ['CASE 5  placement: top, middle, bottom right', [
    [42.5, 45.5, '{\\an8}This line belongs at the top of the screen.'],
    [46.0, 49.0, '{\\an5}This one sits in the middle.'],
    [49.5, 53.6, '{\\an3}Bottom right, aligned to the right,\nwith a second, shorter line.']]],
  ['CASE 6  overlapping lines (shown together)', [
    [54.5, 60.0, 'The first speaker starts talking here,'],
    [56.0, 61.5, 'while a second speaker interrupts.'],
    [62.0, 65.6, 'Both lines should have been on screen together.']]],
  ['CASE 7  a sign at the top over dialogue', [
    [66.5, 75.0, '{\\an8}SIGN: CLOSED FOR REPAIRS'],
    [67.5, 71.0, 'Looks like the shop is closed today.'],
    [71.4, 74.6, "We'll come back tomorrow."]]],
  ['CASE 8  fast dialogue', [
    [78.2, 79.2, 'Ready?'], [79.3, 80.3, 'Ready.'], [80.4, 81.6, 'Go, go, go!'], [81.7, 82.9, 'Left!'],
    [83.0, 84.3, 'No, the other left!'], [84.4, 85.8, 'Sorry!'], [85.9, 87.4, "Never mind, we're here."],
    [87.5, 91.4, 'Fast lines like these can arrive late.']]],
  ['CASE 9  short gaps between lines (box colour)', [
    [92.5, 94.4, 'Each of these lines'], [94.6, 96.5, 'follows the last one'],
    [96.7, 98.6, 'after a very short gap.'], [98.8, 100.7, 'A coloured box should stay'],
    [100.9, 103.0, 'the same colour to the end ♪'], [103.2, 105.6, 'of every line, even this one ♪♪']]],
  ['CASE 10  accents and symbols', [
    [106.5, 110.5, 'Café, ñandú, Ölgemälde and «crème brûlée».'],
    [111.0, 114.5, '¿Sí? “Ça va…” — ¡Sí, ça va!'],
    [115.0, 117.6, 'Five for £3, half off: ½ price. ©®™']]],
  ['CASE 11  a very short line, then a long silence', [
    [118.5, 119.0, 'Hi.'],
    [119.5, 121.5, 'That was a very short line.'],
    [122.0, 129.5, 'After this line, captions should clear when it ends.']]],
  ['CASE 12  quiet stretch, then captions return', [
    [145.0, 149.0, 'Captions are back after fifteen seconds of quiet.']]],
];

function srtSuite() {
  const cues = SRT_CASES.flatMap(([, list]) => list).sort((a, b) => a[0] - b[0]);
  return cues.map(([s, e, t], i) => `${i + 1}\n${srtTime(s)} --> ${srtTime(e)}\n${t}\n`).join('\n');
}
function caseLabels(cases) {
  return cases.map(([label, list]) => [label, list[0][0] - 0.4, Math.max(...list.map((c) => c[1])) + 0.3]);
}

const ASS_EVENTS = [
  // [start, end, style, layer, text]
  [0.5, 4.0, 'Default', 0, 'Default style, bottom centre.'],
  [4.5, 8.0, 'Top', 0, 'Top style, from the style sheet.'],
  [8.5, 12.0, 'Left', 0, 'Left-aligned style.'],
  [12.5, 16.0, 'Right', 0, 'Right-aligned style.'],
  [16.5, 20.0, 'Middle', 0, 'Middle of the screen, from the style.'],
  [21.0, 25.0, 'Default', 0, '{\\pos(1100,650)}Placed exactly, at the bottom right.'],
  [25.5, 29.5, 'Default', 0, '{\\pos(640,80)}Placed exactly, at the top centre.'],
  [30.0, 34.0, 'Default', 0, '{\\move(640,650,640,80)}Moving from the bottom to the top.'],
  [34.5, 38.5, 'Default', 0, '{\\an5}An override: the middle.'],
  [39.0, 43.0, 'Default', 0, '{\\i1}Italic{\\i0} and {\\u1}underlined{\\u0} words.'],
  [43.5, 47.5, 'Default', 0, 'A vector drawing is shown with this line.'],
  [43.5, 47.5, 'Default', 1, '{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}'],
  [48.0, 56.0, 'Sign', 0, 'SIGN: ENTRANCE'],
  [49.0, 53.0, 'Default', 0, 'A sign at the top while someone talks.'],
  [56.5, 60.0, 'Default', 0, 'Line one,\\Nand line two after a manual break.'],
  [60.5, 64.0, 'Default', 0, '♪ Music in an ASS file ♪'],
  [64.5, 68.0, 'Default', 0, 'A layered duplicate should show once.'],
  [64.5, 68.0, 'Default', 1, 'A layered duplicate should show once.'],
  [68.5, 72.0, '*Default', 0, 'A style name with a leading star.'],
  [72.5, 76.0, 'Unknown', 0, 'An unknown style falls back to Default.'],
];
const ASS_CASES = [
  ['ASS 1  styles: bottom, top, left, right, middle', 0.5, 20.0],
  ['ASS 2  exact positions and a move', 21.0, 34.0],
  ['ASS 3  overrides, italics, a drawing', 34.5, 47.5],
  ['ASS 4  a sign over dialogue, line breaks, music', 48.0, 64.0],
  ['ASS 5  duplicates and odd style names', 64.5, 76.0],
];

function assSuite() {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,40,1
Style: Top,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,8,40,40,40,1
Style: Left,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,1,40,40,40,1
Style: Right,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,3,40,40,40,1
Style: Middle,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,5,40,40,40,1
Style: Sign,Arial,36,&H0000FFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,2,1,8,40,40,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return head + ASS_EVENTS.map(([s, e, style, layer, text]) =>
    `Dialogue: ${layer},${assTime(s)},${assTime(e)},${style},,0,0,0,,${text}`).join('\n') + '\n';
}

// ------------------------------------------------------------------ clip catalogue

const P720 = { w: 1280, h: 720, fps: '30' };
const CLIPS = [
  { name: '01-captions-srt', duration: 152, label: 'CAPTIONS 1: SRT SUITE\nitalics, notes, placement, overlaps, fast lines, short gaps',
    video: P720, subs: 'srt', audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', speech: 'srt' }] },
  { name: '02-captions-ass', duration: 78, label: 'CAPTIONS 2: ASS SUITE\nstyles, \\pos, \\move, overrides, a drawing, a sign',
    video: P720, subs: 'ass', audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', speech: 'ass' }] },
  { name: '03-captions-none', duration: 60, label: 'CAPTIONS 3: NO SUBTITLES\nexpect the "No captions for this program" note',
    video: P720, audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng' }] },
  { name: '04-audio-eng-jpn', duration: 120, label: 'AUDIO 1: ENG + JPN  (AC3 5.1 each)\nswitch tracks: English, then Japanese',
    video: P720, audio: [{ lang: 'eng', title: 'English', codec: 'ac3', layout: '5.1', pattern: 'eng' },
      { lang: 'jpn', title: '日本語', codec: 'ac3', layout: '5.1', pattern: 'jpn' }] },
  { name: '05-audio-51-speakers', duration: 96, label: 'AUDIO 2: 5.1 SPEAKER CHECK  (AC3)\neach speaker says its name, LFE hums',
    video: P720, audio: [{ lang: 'eng', codec: 'ac3', layout: '5.1', pattern: '51' }] },
  { name: '06-audio-stereo-lr', duration: 63, label: 'AUDIO 3: STEREO ONLY  (AAC 2.0)\n"Left" left, "Right" right',
    video: P720, audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'lr' }] },
  { name: '07-audio-english-only', duration: 60, label: 'AUDIO 4: ENGLISH ONLY  (E-AC3 2.0)\nthe Japanese slot should repeat English',
    video: P720, audio: [{ lang: 'eng', codec: 'eac3', layout: 'stereo', pattern: 'eng' }] },
  { name: '08-audio-44k', duration: 60, label: 'AUDIO 5: 44.1 kHz  (AAC 2.0)\nsample-rate change at the boundary',
    video: P720, audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng', rate: 44100 }] },
  { name: '09-video-hdr10', duration: 60, label: 'VIDEO 1: HDR10  (HEVC 10-bit PQ, BT.2020)\ntone mapping: colours and white level',
    video: { ...P720, codec: 'hevc', hdr: 'hdr10' }, audio: [{ lang: 'eng', codec: 'ac3', layout: 'stereo', pattern: 'eng' }] },
  { name: '10-video-hlg', duration: 60, label: 'VIDEO 2: HLG  (HEVC 10-bit, BT.2020)\ntone mapping for HLG',
    video: { ...P720, codec: 'hevc', hdr: 'hlg' }, audio: [{ lang: 'eng', codec: 'ac3', layout: 'stereo', pattern: 'eng' }] },
  { name: '11-video-sdr-10bit', duration: 60, label: 'VIDEO 3: 10-BIT SDR  (HEVC Main 10, BT.709)\nmust come out 8-bit, colours unchanged',
    video: { ...P720, codec: 'hevc', tenbit: true }, audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng' }] },
  { name: '12-video-interlaced-2997i', duration: 60, label: 'VIDEO 4: INTERLACED 29.97i TFF  (720x480)\ncombing means no deinterlace',
    video: { w: 720, h: 480, fps: '60000/1001', interlace: true, sar: '8/9' }, audio: [{ lang: 'eng', codec: 'ac3', layout: 'stereo', pattern: 'eng' }] },
  { name: '13-video-23976', duration: 45, label: 'VIDEO 5: 23.976 fps\njudder and frame-rate changes', video: { ...P720, fps: '24000/1001' },
    audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng' }] },
  { name: '14-video-25', duration: 45, label: 'VIDEO 6: 25 fps', video: { ...P720, fps: '25' },
    audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng' }] },
  { name: '15-video-2997', duration: 45, label: 'VIDEO 7: 29.97 fps', video: { ...P720, fps: '30000/1001' },
    audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng' }] },
  { name: '16-video-5994', duration: 45, label: 'VIDEO 8: 59.94 fps\nsmooth motion expected', video: { ...P720, fps: '60000/1001' },
    audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng' }] },
  { name: '17-video-anamorphic', duration: 45, label: 'VIDEO 9: ANAMORPHIC 720x480, SAR 32:27\ncircles must look round (16:9)',
    video: { w: 720, h: 480, fps: '30000/1001', sar: '32/27' }, audio: [{ lang: 'eng', codec: 'ac3', layout: 'stereo', pattern: 'eng' }] },
  { name: '18-transition-a', duration: 30, label: 'TRANSITION A: 720p30, AAC stereo, no subtitles', video: P720,
    audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng' }] },
  { name: '19-transition-b', duration: 30, label: 'TRANSITION B: 1080p23.976, AC3 5.1 ENG + JPN, subtitles',
    video: { w: 1920, h: 1080, fps: '24000/1001' }, subs: 'short',
    audio: [{ lang: 'eng', title: 'English', codec: 'ac3', layout: '5.1', pattern: 'eng' }, { lang: 'jpn', title: '日本語', codec: 'ac3', layout: '5.1', pattern: 'jpn' }] },
  { name: '20-transition-c', duration: 30, label: 'TRANSITION C: 480p29.97 4:3, AAC 44.1 kHz',
    video: { w: 720, h: 480, fps: '30000/1001', sar: '8/9' }, audio: [{ lang: 'eng', codec: 'aac', layout: 'stereo', pattern: 'eng', rate: 44100 }] },
];

const SHORT_SUBS = [[1.0, 4.0, 'Transition B has subtitles.'], [5.0, 9.0, 'The clip before it had none.'],
  [24.0, 29.0, 'The next clip has none again.']];

// ------------------------------------------------------------------ building one clip

const patternCache = {};
function audioTrack(clip, track, i) {
  const rate = track.rate ?? 48000;
  let wav;
  if (track.speech === 'srt') {
    wav = speechTimeline(`${clip.name}-speech`, 'Samantha',
      SRT_CASES.flatMap(([, list]) => list).map(([s, , t]) => [s, spoken(t)]).filter(([, t]) => t), clip.duration, rate);
  } else if (track.speech === 'ass') {
    const seen = new Set();
    const lines = ASS_EVENTS.filter(([s, , , , t]) => spoken(t) && !seen.has(`${s}${spoken(t)}`) && seen.add(`${s}${spoken(t)}`))
      .map(([s, , , , t]) => [s, spoken(t)]);
    wav = speechTimeline(`${clip.name}-speech`, 'Samantha', lines, clip.duration, rate);
  } else {
    const key = track.pattern;
    patternCache[key] ??= key === '51' ? speakerPattern() : key === 'lr' ? stereoPattern() : languagePattern(key);
    wav = loopTo(`${clip.name}-a${i}`, patternCache[key], clip.duration, rate);
  }
  if (track.pattern !== '51' && track.pattern !== 'lr') {
    wav = toLayout(wav, track.layout);
  }
  return wav;
}

function videoFilter(clip) {
  const v = clip.video;
  const scale = v.h / 720;
  const fs1 = Math.round(40 * scale);
  const fs2 = Math.round(30 * scale);
  const box = 'box=1:boxcolor=black@0.65:boxborderw=10';
  const parts = [
    `drawtext=fontfile=${FONTFILE}:textfile=${textFile(clip.label)}:fontsize=${fs1}:fontcolor=white:${box}:x=(w-text_w)/2:y=${Math.round(20 * scale)}:line_spacing=6`,
    `drawtext=fontfile=${FONTFILE}:text='%{pts\\:hms}   frame %{n}   ${clip.name}':fontsize=${fs2}:fontcolor=yellow:${box}:x=${Math.round(20 * scale)}:y=h-${Math.round(170 * scale)}`,
  ];
  const cases = clip.subs === 'srt' ? caseLabels(SRT_CASES) : clip.subs === 'ass' ? ASS_CASES : [];
  for (const [label, start, end] of cases) {
    parts.push(`drawtext=fontfile=${FONTFILE}:textfile=${textFile(label)}:fontsize=${fs2}:fontcolor=cyan:${box}:x=(w-text_w)/2:y=${Math.round(150 * scale)}:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`);
  }
  if (v.sar) parts.push(`setsar=${v.sar}`);
  if (v.interlace) parts.push('tinterlace=mode=interleave_top', 'setfield=tff');
  if (v.hdr === 'hdr10') {
    parts.push('format=yuv420p', 'zscale=tin=bt709:min=bt709:pin=bt709:rin=tv:t=smpte2084:m=bt2020nc:p=bt2020:r=tv:npl=100', 'format=yuv420p10le');
  } else if (v.hdr === 'hlg') {
    parts.push('format=yuv420p', 'zscale=tin=bt709:min=bt709:pin=bt709:rin=tv:t=arib-std-b67:m=bt2020nc:p=bt2020:r=tv:npl=100', 'format=yuv420p10le');
  } else {
    // testsrc2 frames carry no colour tags; without these the encoder leaves primaries and transfer unset
    parts.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709', v.tenbit ? 'format=yuv420p10le' : 'format=yuv420p');
  }
  return parts.join(',');
}

function videoCodecArgs(v) {
  if (v.codec === 'hevc') {
    const colour = v.hdr === 'hdr10'
      ? 'hdr10-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400'
      : v.hdr === 'hlg'
        ? 'repeat-headers=1:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc'
        : 'colorprim=bt709:transfer=bt709:colormatrix=bt709';
    const tags = v.hdr === 'hdr10' ? ['bt2020', 'smpte2084', 'bt2020nc'] : v.hdr === 'hlg' ? ['bt2020', 'arib-std-b67', 'bt2020nc'] : ['bt709', 'bt709', 'bt709'];
    return ['-c:v', 'libx265', '-preset', 'fast', '-crf', '22', '-profile:v', 'main10', '-x265-params', `log-level=error:${colour}`,
      '-color_primaries', tags[0], '-color_trc', tags[1], '-colorspace', tags[2], '-tag:v', 'hvc1'];
  }
  const common = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
  return v.interlace ? [...common, '-flags', '+ilme+ildct', '-x264-params', 'tff=1', '-field_order', 'tt'] : common;
}

const AUDIO_ENC = {
  aac: (t) => ['aac', '-b:a:N', t.layout === '5.1' ? '384k' : '192k'],
  ac3: (t) => ['ac3', '-b:a:N', t.layout === '5.1' ? '448k' : '192k'],
  eac3: (t) => ['eac3', '-b:a:N', t.layout === '5.1' ? '384k' : '192k'],
};

function buildClip(clip) {
  const v = clip.video;
  const inputs = ['-f', 'lavfi', '-i', `testsrc2=size=${v.w}x${v.h}:rate=${v.fps}:duration=${clip.duration}`];
  const audio = clip.audio.map((t, i) => audioTrack(clip, t, i));
  audio.forEach((wav) => inputs.push('-i', wav));
  const out = path.join(OUT, `${clip.name}.mkv`);
  const maps = ['-map', '0:v'];
  const audioArgs = [];
  clip.audio.forEach((t, i) => {
    maps.push('-map', `${i + 1}:a`);
    const [codec, brFlag, br] = AUDIO_ENC[t.codec](t);
    audioArgs.push(`-c:a:${i}`, codec, brFlag.replace('N', String(i)), br, `-ar:a:${i}`, String(t.rate ?? 48000),
      `-metadata:s:a:${i}`, `language=${t.lang}`);
    if (t.title) audioArgs.push(`-metadata:s:a:${i}`, `title=${t.title}`);
    audioArgs.push(`-disposition:a:${i}`, i === 0 ? 'default' : '0');
  });
  ff([...inputs, ...maps, '-vf', videoFilter(clip), ...videoCodecArgs(v), ...audioArgs, '-t', String(clip.duration),
    '-metadata', `title=${clip.label.split('\n')[0]}`, out]);
  if (clip.subs === 'srt') fs.writeFileSync(path.join(OUT, `${clip.name}.en.srt`), srtSuite());
  if (clip.subs === 'ass') fs.writeFileSync(path.join(OUT, `${clip.name}.en.ass`), assSuite());
  if (clip.subs === 'short') {
    fs.writeFileSync(path.join(OUT, `${clip.name}.en.srt`),
      SHORT_SUBS.map(([s, e, t], i) => `${i + 1}\n${srtTime(s)} --> ${srtTime(e)}\n${t}\n`).join('\n'));
  }
  return out;
}

// ------------------------------------------------------------------ probing

function probe(file) {
  const info = JSON.parse(run(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const frame = JSON.parse(run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1',
    '-show_frames', '-show_entries', 'frame=side_data_list,interlaced_frame,top_field_first', '-of', 'json', file]));
  const first = frame.frames?.[0] ?? {};
  const sideData = (first.side_data_list ?? []).map((s) => s.side_data_type).filter((t) => !t.includes('Unregistered'));
  // Matroska's field-order flag reads back oddly (ffmpeg writes "tt" and ffprobe reports "tb"); the frames are what count
  const scan = first.interlaced_frame ? (first.top_field_first ? 'interlaced TFF' : 'interlaced BFF') : 'progressive';
  const v = info.streams.find((s) => s.codec_type === 'video');
  return {
    duration: Number(info.format.duration).toFixed(1),
    video: `${v.codec_name} ${v.profile ?? ''} ${v.width}x${v.height} sar ${v.sample_aspect_ratio ?? '1:1'} ${v.avg_frame_rate} ${v.pix_fmt} ` +
      `${v.color_primaries ?? '-'}/${v.color_transfer ?? '-'}/${v.color_space ?? '-'} ${scan}`,
    hdrSideData: sideData,
    audio: info.streams.filter((s) => s.codec_type === 'audio').map((s) =>
      `${s.codec_name} ${s.channel_layout ?? s.channels + 'ch'} ${s.sample_rate} ${s.tags?.language ?? 'und'}${s.tags?.title ? ` "${s.tags.title}"` : ''}`),
  };
}

// ------------------------------------------------------------------ main

const manifest = {};
for (const clip of CLIPS) {
  if (ONLY.length && !ONLY.some((o) => clip.name.startsWith(o))) continue;
  process.stdout.write(`${clip.name} … `);
  const file = buildClip(clip);
  manifest[clip.name] = { label: clip.label, subtitles: clip.subs ?? null, ...probe(file) };
  console.log('ok');
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.rmSync(WORK, { recursive: true, force: true });
for (const [name, m] of Object.entries(manifest)) {
  console.log(`${name}: ${m.duration}s | ${m.video} | ${m.audio.join(' + ')}${m.hdrSideData.length ? ' | ' + m.hdrSideData.join(', ') : ''}${m.subtitles ? ' | subs ' + m.subtitles : ''}`);
}
