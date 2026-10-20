import { FeatureFlagMetadata } from '@tunarr/types';
import {
  getBooleanEnvVar,
  getEnvVar,
  getFeatureFlagEnvVar,
  getLoggerEnvironmentNames,
  getNumericEnvVar,
  getRawEnvVar,
  TUNARR_ENV_VARS,
} from './env.ts';
import { getEnvironmentLogLevel } from './logging/LoggerFactory.ts';

// Deliberately enumerate safe values. Never expose arbitrary environment entries,
// authentication credentials, filesystem paths, or build-time secrets.
export function getEnvironmentOverrides(): Record<string, string> {
  const result: Record<string, string> = {};
  const strings = [
    TUNARR_ENV_VARS.BIND_ADDR_ENV_VAR,
    TUNARR_ENV_VARS.CORS_ORIGINS_ENV_VAR,
    TUNARR_ENV_VARS.SEARCH_MAX_RAM,
    TUNARR_ENV_VARS.TRUST_PROXY_ENV_VAR,
  ];
  for (const name of strings) {
    const value = getEnvVar(name);
    if (value !== null) result[name] = value;
  }
  const numbers = [
    TUNARR_ENV_VARS.WORKER_POOL_SIZE_ENV_VAR,
    TUNARR_ENV_VARS.SERVER_PORT_ENV_VAR,
    TUNARR_ENV_VARS.SEARCH_PORT,
    TUNARR_ENV_VARS.SEARCH_MAX_INDEXING_THREADS,
    TUNARR_ENV_VARS.SESSION_CLEANUP_DELAY_SECONDS,
    TUNARR_ENV_VARS.SESSION_STALENESS_MS,
  ];
  for (const name of numbers) {
    const value = getNumericEnvVar(name);
    if (value !== null) result[name] = String(value);
  }
  for (const [name, fallback] of [
    [TUNARR_ENV_VARS.USE_WORKER_POOL_ENV_VAR, true],
    [TUNARR_ENV_VARS.SCAN_IN_WORKER_ENV_VAR, true],
    [TUNARR_ENV_VARS.SEARCH_REDUCE_INDEXER_MEMORY_USAGE, false],
    [TUNARR_ENV_VARS.PRINT_ROUTES_ENV_VAR, false],
    [TUNARR_ENV_VARS.MOUNT_DEBUG_ENDPOINTS, false],
  ] as const) {
    if (getEnvVar(name) !== null)
      result[name] = String(getBooleanEnvVar(name, fallback));
  }
  for (const name of [
    TUNARR_ENV_VARS.DATABASE_DEBUG_LOGGING,
    TUNARR_ENV_VARS.SSDP_DEBUG_LOGGING,
  ]) {
    if (getRawEnvVar(name)) result[name] = 'true';
  }
  for (const { envVar } of FeatureFlagMetadata) {
    if (getFeatureFlagEnvVar(envVar) !== null) {
      // Feature flag parsing defaults invalid values to false.
      const registered = Object.values(TUNARR_ENV_VARS).find(
        (name) => name === envVar,
      );
      if (registered !== undefined)
        result[envVar] = String(getBooleanEnvVar(registered, false));
    }
  }
  for (const name of [
    TUNARR_ENV_VARS.SQLITE_CACHE_KIB,
    TUNARR_ENV_VARS.SQLITE_MMAP_BYTES,
    TUNARR_ENV_VARS.DB_WARMUP_MAX_BYTES,
  ]) {
    const raw = getEnvVar(name);
    if (raw !== null && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)))
      result[name] = String(Number(raw));
  }
  const rawTimeout = getEnvVar(
    TUNARR_ENV_VARS.SCAN_JOB_TIMEOUT_MINUTES_ENV_VAR,
  );
  if (rawTimeout !== null) {
    const minutes = Number(rawTimeout);
    if (Number.isInteger(minutes) && minutes >= 0)
      result[TUNARR_ENV_VARS.SCAN_JOB_TIMEOUT_MINUTES_ENV_VAR] = String(
        Math.min(minutes, Math.floor((2 ** 31 - 1) / 60_000)),
      );
  }
  for (const name of getLoggerEnvironmentNames()) {
    const level = getEnvironmentLogLevel(name);
    if (level !== undefined) result[name] = level;
  }
  const logLevel = getEnvironmentLogLevel();
  if (logLevel !== undefined)
    result[TUNARR_ENV_VARS.LOG_LEVEL_ENV_VAR] = logLevel;
  return result;
}
