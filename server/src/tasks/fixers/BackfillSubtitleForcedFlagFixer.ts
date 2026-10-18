import { KEYS } from '@/types/inject.js';
import { and, eq, exists, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import type { DrizzleDBAccess } from '../../db/schema/index.ts';
import { ProgramMediaStream } from '../../db/schema/ProgramMediaStream.ts';
import { ProgramSubtitles } from '../../db/schema/ProgramSubtitles.ts';
import { ProgramVersion } from '../../db/schema/ProgramVersion.ts';
import { InjectLogger } from '../../util/inject.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import Fixer from './fixer.ts';

/**
 * Embedded subtitle streams were stored as not forced until the minter copied
 * the flag, while each one's program_subtitles row, minted from the same scan,
 * kept it. Stream selection reads the stream rows, so a forced-only rule
 * (forced subtitles under English audio) found nothing to burn in, and the
 * caption fallback took a forced track (a dub's signs and songs) ahead of the
 * full one. This copies the flag from the subtitle row, so existing programs
 * heal at startup instead of waiting for their next rescan.
 *
 * Idempotent: only a stream still unflagged whose embedded subtitle row (same
 * program, same stream index) is forced changes, so a re-run is a no-op.
 */
@injectable()
export class BackfillSubtitleForcedFlagFixer extends Fixer {
  @InjectLogger() declare protected readonly logger: Logger;

  constructor(@inject(KEYS.DrizzleDB) private drizzleDB: DrizzleDBAccess) {
    super();
  }

  // One synchronous statement; a failure still rejects, so FixerRunner logs it
  protected runInternal(): Promise<void> {
    return new Promise((resolve) => {
      this.backfill();
      resolve();
    });
  }

  private backfill() {
    const result = this.drizzleDB
      .update(ProgramMediaStream)
      .set({ forced: true })
      .where(
        and(
          eq(ProgramMediaStream.streamKind, 'subtitles'),
          eq(ProgramMediaStream.forced, false),
          exists(
            this.drizzleDB
              .select({ one: sql`1` })
              .from(ProgramVersion)
              .innerJoin(
                ProgramSubtitles,
                eq(ProgramSubtitles.programId, ProgramVersion.programId),
              )
              .where(
                and(
                  eq(ProgramVersion.uuid, ProgramMediaStream.programVersionId),
                  eq(ProgramSubtitles.subtitleType, 'embedded'),
                  eq(ProgramSubtitles.streamIndex, ProgramMediaStream.index),
                  eq(ProgramSubtitles.forced, true),
                ),
              ),
          ),
        ),
      )
      .run();

    if (result.changes > 0) {
      this.logger.info(
        'Marked %d embedded subtitle stream(s) forced, as their subtitle records say',
        result.changes,
      );
    }
  }
}
