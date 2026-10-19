import { getEnvVar, TUNARR_ENV_VARS } from '../util/env.ts';

function nonnegativeInteger(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function databaseTuning() {
  return {
    cacheKiB: nonnegativeInteger(getEnvVar(TUNARR_ENV_VARS.SQLITE_CACHE_KIB)),
    mmapBytes: nonnegativeInteger(getEnvVar(TUNARR_ENV_VARS.SQLITE_MMAP_BYTES)),
    warmupMaxBytes: nonnegativeInteger(
      getEnvVar(TUNARR_ENV_VARS.DB_WARMUP_MAX_BYTES),
    ),
  };
}
