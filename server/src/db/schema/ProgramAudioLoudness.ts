import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { Program } from './Program.ts';

/**
 * The loudness of a program's audio stream, measured once over its file
 * (plans/loudness-measured-once.md), so playback can level it with a fixed
 * gain instead of live loudnorm.
 *
 * Kept apart from program_media_stream, whose rows a rescan replaces: a
 * measurement holds until the file itself changes (another path or size).
 */
export const ProgramAudioLoudness = sqliteTable(
  'program_audio_loudness',
  {
    programId: text()
      .notNull()
      .references(() => Program.uuid, { onDelete: 'cascade' }),
    streamIndex: integer().notNull(),
    // The file the measurement covers
    filePath: text().notNull(),
    fileSize: integer().notNull(),
    // EBU R128, as loudnorm reports them; null when the measurement failed
    integrated: real(),
    truePeak: real(),
    range: real(),
    // Why the measurement failed; it is tried again after a while
    error: text(),
    measuredAt: integer({ mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.programId, table.streamIndex] })],
);

export const ProgramAudioLoudnessRelations = relations(
  ProgramAudioLoudness,
  ({ one }) => ({
    program: one(Program, {
      fields: [ProgramAudioLoudness.programId],
      references: [Program.uuid],
    }),
  }),
);

export type ProgramAudioLoudness = InferSelectModel<typeof ProgramAudioLoudness>;
export type NewProgramAudioLoudness = InferInsertModel<
  typeof ProgramAudioLoudness
>;
