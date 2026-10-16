import { isNonEmptyString } from '@tunarr/shared/util';
import type { MediaSubtitles } from '@tunarr/types';
import { injectable } from 'inversify';
import fs from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { match, P } from 'ts-pattern';
import type { Nullable } from '../../types/util.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import { LanguageService } from '../LanguageService.ts';
import { KnownVideoFileExtensions } from '../scanner/constants.ts';

// Parts of a subtitle file name that describe the subtitles rather than their language
const SubtitleFileFlags = new Set(['hi', 'cc', 'sdh', 'forced']);

@injectable()
export class LocalSubtitlesService {
  private static _logger?: Logger;
  private static get logger() {
    return (this._logger ??= LoggerFactory.child({
      className: LocalSubtitlesService.name,
    }));
  }
  constructor() {}

  async findExternalSubtitles(fullItemPath: string) {
    const subtitles: MediaSubtitles[] = [];
    const directory = dirname(fullItemPath);
    const itemName = basename(fullItemPath, extname(fullItemPath));
    const files = (await fs.readdir(directory, { withFileTypes: true })).filter(
      (dirent) => dirent.isFile(),
    );
    // Other videos whose names extend this one's ("Movie.part2" beside "Movie"):
    // a subtitle that starts with one of those names is that video's.
    const longerVideoNames = files
      .filter((dirent) => KnownVideoFileExtensions.has(extname(dirent.name)))
      .map((dirent) => basename(dirent.name, extname(dirent.name)))
      .filter((name) => name.startsWith(`${itemName}.`));

    for (const dirent of files) {
      // "Episode 1." so that "Episode 10.en.srt" isn't taken for episode 1's
      if (!dirent.name.startsWith(`${itemName}.`)) {
        continue;
      }

      if (longerVideoNames.some((name) => dirent.name.startsWith(`${name}.`))) {
        continue;
      }

      const parsedSubtitles = LocalSubtitlesService.parseSubtitleFilePath(
        fullItemPath,
        join(directory, dirent.name),
      );

      if (!parsedSubtitles) {
        continue;
      }

      subtitles.push(parsedSubtitles);
    }

    return subtitles;
  }

  static parseSubtitleFilePath(
    originalItemPath: string,
    fullPath: string,
  ): Nullable<MediaSubtitles> {
    const itemName = basename(originalItemPath, extname(originalItemPath));
    const fileName = basename(fullPath);
    const codecExt = extname(fileName);
    const codec = match(codecExt.toLowerCase())
      .with(P.union('.ssa', '.ass'), () => 'ass')
      .with('.srt', () => 'subrip')
      .with('.vtt', () => 'webvtt')
      .otherwise(() => null);

    if (!codec) {
      return null;
    }

    // Subtitles generally are meant to be in the form {media_name}(.{lang})?(.{opts})*.{codec_ext}
    // Remove the media name and the codec_ext, read out the options, and take the first
    // other part as the language. A file with no language part is "unknown".
    const parts = basename(fileName, codecExt)
      .replace(itemName, '')
      .toLowerCase()
      .split('.')
      .filter((s) => s.length > 0);
    const lang =
      parts.find((part) => !SubtitleFileFlags.has(part)) ?? 'unknown';

    const sdh =
      parts.includes('hi') || parts.includes('cc') || parts.includes('sdh');
    const forced = parts.includes('forced');

    const maybeLang3T = LanguageService.getAlpha3TCode(
      lang.split(/[-_]/)?.[0] ?? lang,
    );

    if (isNonEmptyString(maybeLang3T)) {
      return {
        codec,
        language: maybeLang3T,
        subtitleType: 'sidecar',
        default: false,
        forced,
        sdh,
        path: fullPath,
      };
    } else {
      this.logger.debug(
        'Found unknown subtitle language (%s) for file: %s',
        lang,
        fullPath,
      );
      return {
        codec,
        language: lang,
        subtitleType: 'sidecar',
        default: false,
        forced,
        sdh,
        path: fullPath,
      };
    }
  }
}
