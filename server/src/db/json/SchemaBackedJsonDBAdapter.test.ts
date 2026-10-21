import type { Adapter } from 'lowdb';
import { z } from 'zod/v4';
import {
  defaultSettings,
  rejectInvalidSubtitlePreferences,
  SettingsFileSchema,
} from '../SettingsDB.ts';
import { SchemaBackedDbAdapter } from './SchemaBackedJsonDBAdapter.ts';

const LineupSchema = z.object({
  items: z.array(z.object({ id: z.string() })),
  startTimeOffsets: z.array(z.number()),
});

type Lineup = z.output<typeof LineupSchema>;

const emptyLineup: Lineup = { items: [], startTimeOffsets: [] };

const populatedLineup: Lineup = {
  items: [{ id: 'program-1' }, { id: 'program-2' }],
  startTimeOffsets: [0, 1000],
};

/**
 * An in-memory stand-in for lowdb's TextFile. Mirrors its contract exactly:
 * `read` resolves null when the file does not exist, and rejects for any other
 * failure. That distinction is the whole subject of these tests.
 */
class FakeTextFile implements Adapter<string> {
  writes: string[] = [];
  #readError: Error | undefined;

  constructor(private contents: string | null) {}

  failReadsWith(error: Error) {
    this.#readError = error;
    return this;
  }

  read(): Promise<string | null> {
    if (this.#readError !== undefined) {
      return Promise.reject(this.#readError);
    }
    return Promise.resolve(this.contents);
  }

  write(str: string): Promise<void> {
    this.writes.push(str);
    this.contents = str;
    return Promise.resolve();
  }
}

const ioError = () =>
  Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });

test('reads through the adapter it was given', async () => {
  const file = new FakeTextFile(JSON.stringify(populatedLineup));
  const subject = new SchemaBackedDbAdapter(
    LineupSchema,
    '/does/not/exist.json',
    emptyLineup,
    file,
  );

  await expect(subject.read()).resolves.toEqual(populatedLineup);
});

test('does not overwrite the file when the read fails', async () => {
  const onDisk = JSON.stringify(populatedLineup);
  const file = new FakeTextFile(onDisk).failReadsWith(ioError());
  const subject = new SchemaBackedDbAdapter(
    LineupSchema,
    '/lineup.json',
    emptyLineup,
    file,
  );

  await subject.read().catch(() => null);

  expect(file.writes).toEqual([]);
});

test('surfaces the read failure to the caller instead of returning defaults', async () => {
  const file = new FakeTextFile(JSON.stringify(populatedLineup)).failReadsWith(
    ioError(),
  );
  const subject = new SchemaBackedDbAdapter(
    LineupSchema,
    '/lineup.json',
    emptyLineup,
    file,
  );

  await expect(subject.read()).rejects.toThrow(/EIO/);
});

test('initializes an absent file from the defaults', async () => {
  const file = new FakeTextFile(null);
  const subject = new SchemaBackedDbAdapter(
    LineupSchema,
    '/lineup.json',
    emptyLineup,
    file,
  );

  await expect(subject.read()).resolves.toEqual(emptyLineup);
  expect(file.writes).toHaveLength(1);
});

test('leaves a valid file untouched', async () => {
  const file = new FakeTextFile(JSON.stringify(populatedLineup));
  const subject = new SchemaBackedDbAdapter(
    LineupSchema,
    '/lineup.json',
    emptyLineup,
    file,
  );

  await expect(subject.read()).resolves.toEqual(populatedLineup);
  expect(file.writes).toEqual([]);
});

test('repairs a file that is missing fields by merging the defaults in', async () => {
  const file = new FakeTextFile(
    JSON.stringify({ items: [{ id: 'program-1' }] }),
  );
  const subject = new SchemaBackedDbAdapter(
    LineupSchema,
    '/lineup.json',
    emptyLineup,
    file,
  );

  await expect(subject.read()).resolves.toEqual({
    items: [{ id: 'program-1' }],
    startTimeOffsets: [],
  });
  expect(file.writes).toHaveLength(1);
});

describe('saved global subtitle preferences', () => {
  const validRow = {
    languageCode: 'eng',
    filter: 'any',
    allowExternal: true,
    allowImageBased: false,
  };

  test.each([
    { ...validRow, languageCode: 'zzx' },
    { ...validRow, filter: undefined },
    { ...validRow, allowExternal: undefined },
    { ...validRow, allowImageBased: 'false' },
  ])(
    'rejects invalid rows before merging defaults or writing: %j',
    async (row) => {
      const defaults = defaultSettings('/data');
      const saved = {
        ...defaults,
        settings: {
          ...defaults.settings,
          ffmpeg: { ...defaults.settings.ffmpeg, subtitlePreferences: [row] },
        },
      };
      const file = new FakeTextFile(JSON.stringify(saved));
      const subject = new SchemaBackedDbAdapter(
        SettingsFileSchema,
        '/settings.json',
        defaults,
        file,
        rejectInvalidSubtitlePreferences,
      );
      await expect(subject.read()).rejects.toThrow();
      expect(file.writes).toEqual([]);
    },
  );

  test('still repairs unrelated missing fields without losing saved preferences', async () => {
    const defaults = defaultSettings('/data');
    const { clientId: _omitted, ...partialSettings } = defaults.settings;
    const file = new FakeTextFile(
      JSON.stringify({
        ...defaults,
        settings: {
          ...partialSettings,
          ffmpeg: {
            ...defaults.settings.ffmpeg,
            subtitlePreferences: [validRow],
          },
        },
      }),
    );
    const subject = new SchemaBackedDbAdapter(
      SettingsFileSchema,
      '/settings.json',
      defaults,
      file,
      rejectInvalidSubtitlePreferences,
    );
    const result = await subject.read();
    expect(result?.settings.clientId).toBe(defaults.settings.clientId);
    expect(result?.settings.ffmpeg.subtitlePreferences).toEqual([validRow]);
    expect(file.writes).toHaveLength(1);
  });
});
