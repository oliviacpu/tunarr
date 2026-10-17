import type { ExcludeByValueType, Nullable } from '@/types/util.js';
import type { LoudnormConfig } from '@tunarr/types';
import { isNil, omitBy } from 'lodash-es';
import type { AnyFunction } from 'ts-essentials';
import type { TranscodeAudioOutputFormat } from '../../../db/schema/TranscodeConfig.ts';
import type { LoudnessGain } from '../../loudness.ts';

export type AudioStateFields = ExcludeByValueType<AudioState, AnyFunction>;

// Fades applied after loudness normalization (so it can't undo them). Times are ms from the start of the audio.
export type AudioFades = {
  fadeInMs: number;
  fadeOut: Nullable<{ startMs: number; durationMs: number }>;
};

const DefaultAudioState: AudioState = {
  audioEncoder: 'aac',
  audioChannels: 2,
  audioBitrate: null,
  audioBufferSize: null,
  audioSampleRate: null,
  audioDuration: null,
  audioVolume: null,
  normalizeLoudness: false,
  loudnormConfig: null,
  loudnessGains: null,
  fades: null,
};

export class AudioState {
  audioEncoder: TranscodeAudioOutputFormat;
  audioChannels: Nullable<number>;
  audioBitrate: Nullable<number>;
  audioBufferSize: Nullable<number>;
  audioSampleRate: Nullable<number>;
  audioDuration: Nullable<number>;
  audioVolume: Nullable<number>;
  normalizeLoudness: boolean;
  loudnormConfig: Nullable<LoudnormConfig>;
  // Fixed gains by source stream index, from measured loudness, in place of
  // live loudnorm (plans/loudness-measured-once.md)
  loudnessGains: Nullable<ReadonlyMap<number, LoudnessGain>>;
  fades: Nullable<AudioFades>;

  private constructor(fields: Partial<AudioStateFields> = {}) {
    const merged: AudioStateFields = {
      ...DefaultAudioState,
      ...omitBy(fields, isNil),
    };
    this.audioEncoder = merged.audioEncoder;
    this.audioChannels = merged.audioChannels;
    this.audioBitrate = merged.audioBitrate;
    this.audioBufferSize = merged.audioBufferSize;
    this.audioSampleRate = merged.audioSampleRate;
    this.audioDuration = merged.audioDuration;
    this.audioVolume = merged.audioVolume;
    this.normalizeLoudness = merged.normalizeLoudness ?? false;
    this.loudnormConfig = merged.loudnormConfig;
    this.loudnessGains = merged.loudnessGains;
    this.fades = merged.fades;
  }

  static create(fields: Partial<AudioStateFields> = {}) {
    return new AudioState(fields);
  }
}
