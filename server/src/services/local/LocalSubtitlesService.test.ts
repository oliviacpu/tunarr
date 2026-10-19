import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalSubtitlesService } from './LocalSubtitlesService.ts';

describe('LocalSubtitlesService', () => {
  test('matches mixed-case names without claiming a longer video name', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-case-'));
    try {
      await Promise.all(
        [
          'MOVIE.MKV',
          'movie.EN.SRT',
          'Movie.PART2.MKV',
          'MOVIE.part2.FR.SRT',
        ].map((name) => fs.writeFile(path.join(dir, name), '')),
      );
      const found = await new LocalSubtitlesService().findExternalSubtitles(
        path.join(dir, 'MOVIE.MKV'),
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        language: 'eng',
        path: path.join(dir, 'movie.EN.SRT'),
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('parse basic', () => {
    const subs = LocalSubtitlesService.parseSubtitleFilePath(
      '/a/b/c/The Player (1992) {imdb-tt0105151}.mkv',
      '/a/b/c/The Player (1992) {imdb-tt0105151}.en.hi.srt',
    );
    expect(subs?.language).toEqual('eng');
    expect(subs?.sdh).toBeTruthy();
  });

  test('parse en-us', () => {
    const subs = LocalSubtitlesService.parseSubtitleFilePath(
      "/a/b/c/Blahblah's Mystery Circus.mkv",
      "/a/b/c/Blahblah's Mystery Circus.en-us.cc.srt",
    );

    expect(subs?.language).toEqual('eng');
    expect(subs?.sdh).toBeTruthy();
  });

  test('parse en_US', () => {
    const subs = LocalSubtitlesService.parseSubtitleFilePath(
      "/a/b/c/Blahblah's Mystery Circus.mkv",
      "/a/b/c/Blahblah's Mystery Circus.en_US.cc.srt",
    );

    expect(subs?.language).toEqual('eng');
    expect(subs?.sdh).toBeTruthy();
  });

  test('parse title with dot in name', () => {
    const subs = LocalSubtitlesService.parseSubtitleFilePath(
      '/a/b/c/Mrs. Sureice (1080p).mkv',
      '/a/b/c/Mrs. Sureice (1080p).en-us.cc.srt',
    );

    expect(subs?.language).toEqual('eng');
    expect(subs?.sdh).toBeTruthy();
  });

  test('a subtitle without a language is unknown, not its extension', () => {
    const subs = LocalSubtitlesService.parseSubtitleFilePath(
      '/a/b/c/Movie (2010).mkv',
      '/a/b/c/Movie (2010).srt',
    );

    expect(subs?.codec).toEqual('subrip');
    expect(subs?.language).toEqual('unknown');
  });

  test('flags before the language are flags', () => {
    const subs = LocalSubtitlesService.parseSubtitleFilePath(
      '/a/b/c/Movie (2010).mkv',
      '/a/b/c/Movie (2010).forced.fr.ass',
    );

    expect(subs?.codec).toEqual('ass');
    expect(subs?.language).toEqual('fra');
    expect(subs?.forced).toBe(true);
    expect(subs?.sdh).toBe(false);
  });

  test.each([
    ['Movie (2010).hi.srt', 'hin', false],
    ['Movie (2010).en.hi.srt', 'eng', true],
    ['Movie (2010).hi.sdh.srt', 'hin', true],
    ['Movie (2010).sdh.srt', 'unknown', true],
    ['Movie (2010).cc.de.srt', 'deu', true],
    ['Movie (2010).qaa.hi.srt', 'qaa', true],
    ['Movie (2010).commentary.en.srt', 'eng', false],
  ])(
    '"hi" is Hindi where the language goes, and hard of hearing after it: %s',
    (file, language, sdh) => {
      const subs = LocalSubtitlesService.parseSubtitleFilePath(
        '/a/b/c/Movie (2010).mkv',
        `/a/b/c/${file}`,
      );

      expect(subs?.language).toEqual(language);
      expect(subs?.sdh).toBe(sdh);
    },
  );

  test('upper-case extensions are recognised', () => {
    const subs = LocalSubtitlesService.parseSubtitleFilePath(
      '/a/b/c/Movie (2010).mkv',
      '/a/b/c/Movie (2010).en.SRT',
    );

    expect(subs?.codec).toEqual('subrip');
    expect(subs?.language).toEqual('eng');
  });

  describe('findExternalSubtitles', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-sidecars-'));
    });

    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    async function touch(...names: string[]) {
      for (const name of names) {
        await fs.writeFile(path.join(dir, name), '');
      }
    }

    test('finds the subtitle files next to a video, with their full paths', async () => {
      await touch(
        'The Player (1992).mkv',
        'The Player (1992).en.hi.srt',
        'The Player (1992).fr.forced.ass',
        'The Player (1992).nfo',
      );

      const subs = await new LocalSubtitlesService().findExternalSubtitles(
        path.join(dir, 'The Player (1992).mkv'),
      );

      expect(subs).toHaveLength(2);
      expect(subs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            codec: 'subrip',
            language: 'eng',
            sdh: true,
            forced: false,
            subtitleType: 'sidecar',
            path: path.join(dir, 'The Player (1992).en.hi.srt'),
          }),
          expect.objectContaining({
            codec: 'ass',
            language: 'fra',
            forced: true,
            subtitleType: 'sidecar',
            path: path.join(dir, 'The Player (1992).fr.forced.ass'),
          }),
        ]),
      );
    });

    test('a dot in the video name is part of the name, not an extension', async () => {
      await touch('Movie.2010.mkv', 'Movie.2010.en.srt', 'Movie.2010.srt');

      const subs = await new LocalSubtitlesService().findExternalSubtitles(
        path.join(dir, 'Movie.2010.mkv'),
      );

      expect(subs.map((s) => s.language).sort()).toEqual(['eng', 'unknown']);
    });

    test("another video's subtitles in the same folder are not picked up", async () => {
      await touch(
        'Episode 1.mkv',
        'Episode 1.en.srt',
        'Episode 10.mkv',
        'Episode 10.en.srt',
      );
      await fs.mkdir(path.join(dir, 'Episode 1.de.srt'));

      const subs = await new LocalSubtitlesService().findExternalSubtitles(
        path.join(dir, 'Episode 1.mkv'),
      );

      expect(subs.map((s) => s.path)).toEqual([
        path.join(dir, 'Episode 1.en.srt'),
      ]);
    });

    test('a subtitle named after a longer video name belongs to that video', async () => {
      await touch(
        'Movie.mkv',
        'Movie.en.srt',
        'Movie.part2.mkv',
        'Movie.part2.en.srt',
      );

      const service = new LocalSubtitlesService();
      const first = await service.findExternalSubtitles(
        path.join(dir, 'Movie.mkv'),
      );
      const second = await service.findExternalSubtitles(
        path.join(dir, 'Movie.part2.mkv'),
      );

      expect(first.map((s) => s.path)).toEqual([
        path.join(dir, 'Movie.en.srt'),
      ]);
      expect(second.map((s) => [s.path, s.language])).toEqual([
        [path.join(dir, 'Movie.part2.en.srt'), 'eng'],
      ]);
    });
  });
});
