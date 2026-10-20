import { ChannelSchema } from '@tunarr/types/schemas';
import { SchemaBackedDbAdapter } from '../json/SchemaBackedJsonDBAdapter.ts';
import { CurrentLineupSchemaVersion, LineupSchema } from './Lineup.ts';

const legacyLineup = {
  version: CurrentLineupSchemaVersion,
  lastUpdated: 1234,
  items: [{ type: 'offline', durationMs: 60_000 }],
  startTimeOffsets: [0],
  dynamicContentConfig: { enabled: true, retiredInvalidContent: true },
};

test('reads an old lineup without dropping its programs when the retired key is present', async () => {
  const adapter = new SchemaBackedDbAdapter(
    LineupSchema,
    '/unused/lineup.json',
    null,
    {
      read: async () => JSON.stringify(legacyLineup),
      write: async () => {},
    },
  );
  const parsed = await adapter.read();
  expect(parsed?.items).toEqual(legacyLineup.items);
  expect(parsed?.lastUpdated).toBe(1234);
  expect(parsed).not.toHaveProperty('dynamicContentConfig');
});

test('a legacy channel read strips retired transcoding without losing active fields', () => {
  const legacy = {
    disableFillerOverlay: false,
    duration: 60_000,
    groupTitle: 'Legacy',
    guideMinimumDuration: 30_000,
    icon: { path: '', width: 0, duration: 0, position: 'bottom-right' },
    id: 'channel-1',
    name: 'Legacy channel',
    number: 1,
    offline: { mode: 'pic' },
    startTime: 1234,
    stealth: false,
    onDemand: { enabled: false },
    programCount: 1,
    streamMode: 'hls',
    transcodeConfigId: '00000000-0000-0000-0000-000000000000',
    subtitlesEnabled: false,
    transcoding: { retiredInvalidValue: true },
  };
  const parsed = ChannelSchema.parse(legacy);
  expect(parsed).not.toHaveProperty('transcoding');
  expect(parsed.name).toBe(legacy.name);
  expect(parsed.offline).toEqual(legacy.offline);
  expect(parsed.programCount).toBe(1);
});
