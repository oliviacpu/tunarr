import { AudioFormats } from '../constants.ts';
import {
  type ConstantOutputOption,
  makeConstantOutputOption,
} from './OutputOption.ts';

export const AudioChannelsOutputOption = (
  audioFormat: string,
  sourceChannels: number,
  desiredChannels: number,
): ConstantOutputOption => {
  const opts: string[] = [];
  if (
    sourceChannels !== desiredChannels ||
    ((audioFormat === AudioFormats.Aac || audioFormat === AudioFormats.Opus) &&
      desiredChannels > 2)
  ) {
    opts.push('-ac', desiredChannels.toString());
  }

  return makeConstantOutputOption(opts);
};

// Tag an output audio track's language (ISO 639-2, e.g. "eng") so clients don't treat every program as
// foreign-language audio. Tunarr's output has one audio track, or one per slot of a channel's fixed audio track
// layout (`outputIndex`).
export const AudioLanguageOutputOption = (
  iso6392: string,
  outputIndex: number = 0,
): ConstantOutputOption =>
  makeConstantOutputOption([
    `-metadata:s:a:${outputIndex}`,
    `language=${iso6392}`,
  ]);

export const AudioBitrateOutputOption = (
  bitrate: number,
): ConstantOutputOption =>
  makeConstantOutputOption([
    '-b:a',
    `${bitrate}k`,
    '-maxrate:a',
    `${bitrate}k`,
  ]);

export const AudioBufferSizeOutputOption = (
  bufSize: number,
): ConstantOutputOption =>
  makeConstantOutputOption(['-bufsize:a', `${bufSize}k`]);

export const AudioSampleRateOutputOption = (
  rate: number,
): ConstantOutputOption => makeConstantOutputOption(['-ar', `${rate}k`]);
