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

// Tunarr's output has one audio stream. Tag its language (ISO 639-2, e.g. "eng") so clients don't treat every
// program as foreign-language audio.
export const AudioLanguageOutputOption = (
  iso6392: string,
): ConstantOutputOption =>
  makeConstantOutputOption(['-metadata:s:a:0', `language=${iso6392}`]);

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
