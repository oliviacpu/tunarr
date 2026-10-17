import { KEYS } from '@/types/inject.js';
import { eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import { chunk } from 'lodash-es';
import type { NewProgramAudioLoudness } from './schema/ProgramAudioLoudness.ts';
import { ProgramAudioLoudness } from './schema/ProgramAudioLoudness.ts';
import type { DrizzleDBAccess } from './schema/index.ts';

/** Measured loudness of programs' audio streams (plans/loudness-measured-once.md). */
@injectable()
export class ProgramAudioLoudnessDB {
  constructor(@inject(KEYS.DrizzleDB) private drizzle: DrizzleDBAccess) {}

  getForProgram(programId: string): Promise<ProgramAudioLoudness[]> {
    return this.drizzle
      .select()
      .from(ProgramAudioLoudness)
      .where(eq(ProgramAudioLoudness.programId, programId));
  }

  async getForPrograms(
    programIds: readonly string[],
  ): Promise<ProgramAudioLoudness[]> {
    const rows: ProgramAudioLoudness[] = [];
    for (const ids of chunk([...new Set(programIds)], 500)) {
      rows.push(
        ...(await this.drizzle
          .select()
          .from(ProgramAudioLoudness)
          .where(inArray(ProgramAudioLoudness.programId, ids))),
      );
    }
    return rows;
  }

  // One row per program and stream: a new measurement replaces the old one
  async record(row: NewProgramAudioLoudness): Promise<void> {
    await this.drizzle
      .insert(ProgramAudioLoudness)
      .values(row)
      .onConflictDoUpdate({
        target: [ProgramAudioLoudness.programId, ProgramAudioLoudness.streamIndex],
        set: {
          filePath: row.filePath,
          fileSize: row.fileSize,
          integrated: row.integrated ?? null,
          truePeak: row.truePeak ?? null,
          range: row.range ?? null,
          error: row.error ?? null,
          measuredAt: row.measuredAt,
        },
      });
  }
}
