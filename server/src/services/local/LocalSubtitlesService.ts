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
// Two or three letters, with an optional region: "en", "eng", "en-us", "pt_BR", "qaa"
const LanguageCodeShape = /^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/;

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
    const videoNames = files
      .filter((dirent) =>
        KnownVideoFileExtensions.has(extname(dirent.name).toLowerCase()),
      )
      .map((dirent) => basename(dirent.name, extname(dirent.name)));
    const foldedItemName = itemName.toLowerCase();
    const hasCaseDistinctSibling = videoNames.some(
      (name) => name !== itemName && name.toLowerCase() === foldedItemName,
    );
    // Other videos whose names extend this one's ("Movie.part2" beside "Movie"):
    // a subtitle that starts with one of those names is that video's.
    const longerVideoNames = videoNames
      .map((name) => name.toLowerCase())
      .filter((name) => name.startsWith(`${foldedItemName}.`));

    for (const dirent of files) {
      // "Episode 1." so that "Episode 10.en.srt" isn't taken for episode 1's
      if (!dirent.name.toLowerCase().startsWith(`${itemName.toLowerCase()}.`)) {
        continue;
      }

      if (hasCaseDistinctSibling && !dirent.name.startsWith(`${itemName}.`)) {
        continue;
      }

      if (
        longerVideoNames.some((name) =>
          dirent.name.toLowerCase().startsWith(`${name}.`),
        )
      ) {
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
    // Remove the media name and the codec_ext. The language is the first part that is a
    // language code, or looks like one and isn't an option (a private code such as "qaa"):
    // "Movie.hi.srt" is Hindi, "Movie.en.hi.srt" and "Movie.qaa.hi.srt" are for the hard of
    // hearing, and "Movie.commentary.en.srt" is English. Failing that, it is the first part
    // that isn't an option, and "unknown" when there is none. The other parts are the options.
    const parts = basename(fileName, codecExt)
      .slice(itemName.length)
      .toLowerCase()
      .split('.')
      .filter((s) => s.length > 0);
    const languageCode = (part: string) =>
      LanguageService.getAlpha3TCode(part.split(/[-_]/)[0] ?? part);
    let languageIndex = parts.findIndex(
      (part) =>
        languageCode(part) !== undefined ||
        (LanguageCodeShape.test(part) && !SubtitleFileFlags.has(part)),
    );
    if (languageIndex < 0) {
      languageIndex = parts.findIndex((part) => !SubtitleFileFlags.has(part));
    }
    const lang =
      languageIndex >= 0 ? (parts[languageIndex] ?? 'unknown') : 'unknown';
    const opts = parts.filter((_, index) => index !== languageIndex);

    const sdh =
      opts.includes('hi') || opts.includes('cc') || opts.includes('sdh');
    const forced = opts.includes('forced');

    const maybeLang3T = languageCode(lang);

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
