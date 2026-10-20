import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('TUNARR_VERSION', 'v2026.10.1');
  vi.stubEnv('TUNARR_EDGE_BUILD', 'true');
});
afterEach(() => vi.unstubAllEnvs());

it('uses the corrected commit variable for edge builds before the legacy input', async () => {
  vi.stubEnv('TUNARR_BUILD_SHA', 'correct-sha');
  vi.stubEnv('TUNARR_BUILD', 'legacy-sha');
  const { getTunarrVersion } = await import('./version.ts');
  expect(getTunarrVersion()).toBe('2026.10.1-correct-sha');
});

it('keeps existing builds working with the legacy commit input', async () => {
  vi.stubEnv('TUNARR_BUILD_SHA', undefined);
  vi.stubEnv('TUNARR_BUILD', 'legacy-sha');
  const { getTunarrVersion } = await import('./version.ts');
  expect(getTunarrVersion()).toBe('2026.10.1-legacy-sha');
});
