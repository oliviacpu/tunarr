import { HdhrSettingsSchema } from '@tunarr/types/schemas';
import { Low, Memory } from 'lowdb';
import type { SettingsFile } from './SettingsDB.ts';
import {
  defaultSettings,
  SettingsDB,
  SettingsFileSchema,
} from './SettingsDB.ts';

type Data = {
  obj: {
    x: number;
    y: string;
  };
};

test('LowDB referential uppdates', async () => {
  const db = new Low<Data>(new Memory(), { obj: { x: 1, y: 'string' } });
  await db.read();
  const data = db.data;
  console.log(data);
  data.obj.x = 100;
  await db.write();
  console.log(db.data);
});

describe('pendingOperations', () => {
  const makeSettingsDb = () => {
    const initial = defaultSettings('/tmp/tunarr-test');
    return new SettingsDB(new Low<SettingsFile>(new Memory(), initial));
  };

  test('empty trash request round-trips back to null', async () => {
    const settingsDb = makeSettingsDb();

    expect(settingsDb.pendingOperations.emptyTrashRequestedAt).toBeNull();

    await settingsDb.markEmptyTrashRequested(1234);
    expect(settingsDb.pendingOperations.emptyTrashRequestedAt).toBe(1234);

    // lodash `merge` skips `undefined` but does assign `null`, which is what
    // makes clearing work through updateBaseSettings.
    await settingsDb.clearEmptyTrashRequested();
    expect(settingsDb.pendingOperations.emptyTrashRequestedAt).toBeNull();
  });

  test('a settings file predating pendingOperations parses with a default', () => {
    const withoutSection: Record<string, unknown> = {
      ...defaultSettings('/tmp/tunarr-test'),
    };
    delete withoutSection.pendingOperations;

    const parsed = SettingsFileSchema.parse(withoutSection);
    expect(parsed.pendingOperations).toEqual({ emptyTrashRequestedAt: null });
  });
});

describe('legacy XMLTV guide coverage', () => {
  test.each([0, 0.5, 1, 2])(
    'clamps an old %s-hour guide without rewriting settings',
    (hours) => {
      const initial = defaultSettings('/tmp/tunarr-test');
      initial.settings.xmltv.programmingHours = hours;
      const settings = new SettingsDB(
        new Low<SettingsFile>(new Memory(), initial),
      );
      expect(settings.xmlTvSettings().programmingHours).toBe(3);
      expect(settings.getAll().settings.xmltv.programmingHours).toBe(hours);
    },
  );
});

describe('legacy HDHR tuner count', () => {
  test.each([
    [0, 1],
    [-3, 1],
    [2.5, 2],
    [Number.MAX_SAFE_INTEGER + 2, Number.MAX_SAFE_INTEGER],
    [1e300, Number.MAX_SAFE_INTEGER],
  ])(
    'reads an old tuner count of %s as %s and keeps the rest of the file',
    (tunerCount, expected) => {
      const file = defaultSettings('/tmp/tunarr-test');
      file.settings.hdhr = { autoDiscoveryEnabled: false, tunerCount };
      file.settings.xmltv.programmingHours = 36;

      const parsed = SettingsFileSchema.parse(file);

      expect(parsed.settings.hdhr).toEqual({
        autoDiscoveryEnabled: false,
        tunerCount: expected,
      });
      expect(HdhrSettingsSchema.safeParse(parsed.settings.hdhr).success).toBe(
        true,
      );
      expect(parsed.settings.xmltv.programmingHours).toBe(36);
    },
  );

  test('a file without a tuner count gets the default', () => {
    const file = defaultSettings('/tmp/tunarr-test');
    const parsed = SettingsFileSchema.parse({
      ...file,
      settings: { ...file.settings, hdhr: { autoDiscoveryEnabled: true } },
    });

    expect(parsed.settings.hdhr.tunerCount).toBe(2);
  });
});

test('default settings own their tuner configuration', () => {
  const first = defaultSettings('/tmp/first');
  const second = defaultSettings('/tmp/second');
  first.settings.hdhr.tunerCount = 17;
  first.settings.hdhr.autoDiscoveryEnabled = false;
  expect(second.settings.hdhr).toEqual(HdhrSettingsSchema.parse({}));
  expect(defaultSettings('/tmp/third').settings.hdhr).toEqual(
    HdhrSettingsSchema.parse({}),
  );
});
