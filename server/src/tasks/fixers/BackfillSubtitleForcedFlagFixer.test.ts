import { bootstrapTunarr } from '@/bootstrap.js';
import { DBAccess } from '@/db/DBAccess.js';
import { Program } from '@/db/schema/Program.js';
import { ProgramMediaStream } from '@/db/schema/ProgramMediaStream.js';
import { ProgramSubtitles } from '@/db/schema/ProgramSubtitles.js';
import { ProgramVersion } from '@/db/schema/ProgramVersion.js';
import type { DrizzleDBAccess } from '@/db/schema/index.js';
import { setGlobalOptionsUnchecked } from '@/globals.js';
import { copyPreMigratedDb } from '@/testing/testDbFactory.js';
import { asc, eq } from 'drizzle-orm';
import tmp from 'tmp-promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackfillSubtitleForcedFlagFixer } from './BackfillSubtitleForcedFlagFixer.js';

describe('BackfillSubtitleForcedFlagFixer', () => {
  let cleanup: () => Promise<void>;
  let drizzle: DrizzleDBAccess;

  function insertProgram(programId: string, versionId: string) {
    drizzle
      .insert(Program)
      .values({
        uuid: programId,
        duration: 60_000,
        externalKey: programId,
        externalSourceId: 'test-source',
        sourceType: 'plex',
        title: programId,
        type: 'episode' as const,
      })
      .run();
    drizzle
      .insert(ProgramVersion)
      .values({
        uuid: versionId,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        duration: 60_000,
        scanKind: 'progressive',
        width: 720,
        height: 480,
        programId,
      })
      .run();
  }

  function insertStream(
    versionId: string,
    index: number,
    streamKind: 'audio' | 'subtitles',
    codec: string,
  ) {
    drizzle
      .insert(ProgramMediaStream)
      .values({
        uuid: `${versionId}-${index}`,
        index,
        codec,
        streamKind,
        language: 'eng',
        programVersionId: versionId,
      })
      .run();
  }

  function insertSubtitle(
    programId: string,
    streamIndex: number | null,
    forced: boolean,
    subtitleType: 'embedded' | 'sidecar' = 'embedded',
  ) {
    drizzle
      .insert(ProgramSubtitles)
      .values({
        uuid: `${programId}-sub-${streamIndex ?? 'sidecar'}`,
        subtitleType,
        streamIndex,
        codec: 'srt',
        language: 'eng',
        forced,
        programId,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })
      .run();
  }

  function forcedByIndex(versionId: string) {
    return drizzle
      .select({
        index: ProgramMediaStream.index,
        forced: ProgramMediaStream.forced,
      })
      .from(ProgramMediaStream)
      .where(eq(ProgramMediaStream.programVersionId, versionId))
      .orderBy(asc(ProgramMediaStream.index))
      .all()
      .map(({ index, forced }) => [index, forced]);
  }

  beforeAll(async () => {
    const dbResult = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dbResult.path);
    const opts = setGlobalOptionsUnchecked({
      database: dbResult.path,
      log_level: 'debug',
      verbose: 0,
    });
    await bootstrapTunarr(opts);
    const connection = DBAccess.instance.drizzle;
    if (!connection) {
      throw new Error('Expected Drizzle DB connection to be initialized');
    }
    drizzle = connection;
    cleanup = async () => {
      await DBAccess.instance.closeConnection(`${dbResult.path}/db.db`);
      await dbResult.cleanup();
    };

    // A DVD rip as scanned before the fix: every stream row unflagged, while
    // the subtitle rows say stream 5 (signs and songs, text) is forced
    insertProgram('dub', 'dub-version');
    insertStream('dub-version', 1, 'audio', 'ac3');
    insertStream('dub-version', 2, 'audio', 'ac3');
    insertStream('dub-version', 3, 'subtitles', 'vobsub');
    insertStream('dub-version', 4, 'subtitles', 'vobsub');
    insertStream('dub-version', 5, 'subtitles', 'srt');
    insertStream('dub-version', 6, 'subtitles', 'srt');
    insertSubtitle('dub', 3, false);
    insertSubtitle('dub', 4, false);
    insertSubtitle('dub', 5, true);
    insertSubtitle('dub', 6, false);
    // A forced sidecar has no stream index; it must not flag any stream
    insertSubtitle('dub', null, true, 'sidecar');

    // A forced subtitle row whose index belongs to another program's stream
    // must leave this program's stream alone
    insertProgram('other', 'other-version');
    insertStream('other-version', 5, 'subtitles', 'srt');
    // And a forced subtitle row never flags an audio stream with its index
    insertProgram('audio-index', 'audio-index-version');
    insertStream('audio-index-version', 1, 'audio', 'ac3');
    insertSubtitle('audio-index', 1, true);
  });

  afterAll(async () => {
    await cleanup();
  });

  it('marks forced each embedded subtitle stream its subtitle row says is forced', async () => {
    await new BackfillSubtitleForcedFlagFixer(drizzle).run();

    expect(forcedByIndex('dub-version')).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, true],
      [6, false],
    ]);
    expect(forcedByIndex('other-version')).toEqual([[5, false]]);
    expect(forcedByIndex('audio-index-version')).toEqual([[1, false]]);
  });

  it('changes nothing when run again', async () => {
    await new BackfillSubtitleForcedFlagFixer(drizzle).run();

    expect(forcedByIndex('dub-version')).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, true],
      [6, false],
    ]);
  });
});
