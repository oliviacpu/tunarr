import { databaseTuning } from './databaseTuning.ts';

afterEach(() => vi.unstubAllEnvs());

test('accepts explicit cache, mmap and disabled warm-up settings', () => {
  vi.stubEnv('TUNARR_SQLITE_CACHE_KIB', '65536');
  vi.stubEnv('TUNARR_SQLITE_MMAP_BYTES', '268435456');
  vi.stubEnv('TUNARR_DB_WARMUP_MAX_BYTES', '0');
  expect(databaseTuning()).toEqual({
    cacheKiB: 65536,
    mmapBytes: 268435456,
    warmupMaxBytes: 0,
  });
});

test.each(['-1', '1.5', '100garbage', '9007199254740992'])(
  'ignores invalid limits: %s',
  (value) => {
    vi.stubEnv('TUNARR_DB_WARMUP_MAX_BYTES', value);
    expect(databaseTuning().warmupMaxBytes).toBeUndefined();
  },
);
