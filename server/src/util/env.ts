import { BUILD_ENV, BUILD_ENV_KEYS } from '@/generated/env.js';
import { TruthyQueryParam } from '@tunarr/types/schemas';
import type { Nullable } from '../types/util.ts';

// Internal
const BUILD_ENV_VAR = 'TUNARR_VERSION';
const COMMIT_SHA_ENV_VAR = 'TUNARR_BUILD_SHA';
export const BASE_IMAGE_TAG_ENV_VAR = 'TUNARR_BUILD_BASE_TAG';
const IS_EDGE_BUILD_ENV_VAR = 'TUNARR_EDGE_BUILD';

// General
export const DATABASE_LOCATION_ENV_VAR = 'TUNARR_DATABASE_PATH';
const SERVER_PORT_ENV_VAR = 'TUNARR_SERVER_PORT';
const LOG_LEVEL_ENV_VAR = 'TUNARR_LOG_LEVEL';
const BASIC_AUTH_USER_ENV_VAR = 'TUNARR_BASIC_AUTH_USER';
const BASIC_AUTH_PASSWORD_ENV_VAR = 'TUNARR_BASIC_AUTH_PASSWORD';

// Advanced overrides
const MEILISEARCH_PATH = 'TUNARR_MEILISEARCH_PATH';
const SEARCH_PORT = 'TUNARR_SEARCH_PORT';
const TRUST_PROXY_ENV_VAR = 'TUNARR_SERVER_TRUST_PROXY';
const SESSION_CLEANUP_DELAY_SECONDS = 'TUNARR_SESSION_CLEANUP_DELAY_SECONDS';
const SEARCH_MAX_RAM = 'TUNARR_SEARCH_MAX_MEMORY';
const SEARCH_REDUCE_INDEXER_MEMORY_USAGE =
  'TUNARR_SEARCH_REDUCE_INDEXER_MEMORY_USAGE';
const SEARCH_MAX_INDEXING_THREADS = 'TUNARR_SEARCH_MAX_INDEXING_THREADS';
export const USE_WORKER_POOL_ENV_VAR = 'TUNARR_USE_WORKER_POOL';
export const WORKER_POOL_SIZE_ENV_VAR = 'TUNARR_WORKER_POOL_SIZE';
// Library scans run in a worker thread (default on; needs the worker pool)
export const SCAN_IN_WORKER_ENV_VAR = 'TUNARR_SCAN_IN_WORKER';
// Minutes a scan job may run in its worker before the worker is terminated and
// the job fails (default: no limit)
export const SCAN_JOB_TIMEOUT_MINUTES_ENV_VAR =
  'TUNARR_SCAN_JOB_TIMEOUT_MINUTES';
const BIND_ADDR_ENV_VAR = 'TUNARR_BIND_ADDR';
const MOUNT_DEBUG_ENDPOINTS = 'TUNARR_MOUNT_DEBUG_ENDPOINTS';
const CORS_ORIGINS_ENV_VAR = 'TUNARR_CORS_ORIGINS';
const SESSION_STALENESS_MS = 'TUNARR_SESSION_STALENESS_MS';

// "Feature flags"
const PROXY_ARTWORK_ENV_VAR = 'TUNARR_PROXY_ARTWORK';
export const TONEMAP_ENABLED = 'TUNARR_TONEMAP_ENABLED';
const WEBVTT_SIDECAR_ENABLED = 'TUNARR_WEBVTT_SIDECAR_ENABLED';
const XMLTV_CREDIT_IMAGES_ENABLED = 'TUNARR_XMLTV_CREDIT_IMAGES_ENABLED';

// Escape hatches for new features
const DISABLE_SEARCH_SNAPSHOT_IN_BACKUP =
  'TUNARR_DISABLE_SEARCH_SNAPSHOT_IN_BACKUP';
const DISABLE_VULKAN = 'TUNARR_DISABLE_VULKAN';
const DISABLE_VAAPI_PAD = 'TUNARR_DISABLE_VAAPI_PAD';

// Debug vars
const PRINT_ROUTES_ENV_VAR = 'TUNARR_SERVER_PRINT_ROUTES';

export const TUNARR_ENV_VARS = {
  LEGACY_BUILD_ENV_VAR: 'TUNARR_BUILD',
  DATABASE_NAME: 'TUNARR_DATABASE_NAME',
  DATABASE_DEBUG_LOGGING: 'DATABASE_DEBUG_LOGGING',
  SSDP_DEBUG_LOGGING: 'ENABLE_SSDP_DEBUG_LOGGING',
  NODE_ENV: 'NODE_ENV',
  APPDATA: 'APPDATA',
  HOME: 'HOME',
  CONTAINER: 'CONTAINER',
  CONTAINER_LOWERCASE: 'container',

  SQLITE_CACHE_KIB: 'TUNARR_SQLITE_CACHE_KIB',
  SQLITE_MMAP_BYTES: 'TUNARR_SQLITE_MMAP_BYTES',
  DB_WARMUP_MAX_BYTES: 'TUNARR_DB_WARMUP_MAX_BYTES',
  DATABASE_LOCATION_ENV_VAR,
  SERVER_PORT_ENV_VAR,
  PRINT_ROUTES_ENV_VAR,
  TRUST_PROXY_ENV_VAR,
  PROXY_ARTWORK_ENV_VAR,
  BIND_ADDR_ENV_VAR,
  BUILD_ENV_VAR,
  COMMIT_SHA_ENV_VAR,
  IS_EDGE_BUILD_ENV_VAR,
  BASE_IMAGE_TAG_ENV_VAR,
  USE_WORKER_POOL_ENV_VAR,
  WORKER_POOL_SIZE_ENV_VAR,
  SCAN_IN_WORKER_ENV_VAR,
  SCAN_JOB_TIMEOUT_MINUTES_ENV_VAR,
  SEARCH_PORT,
  SEARCH_MAX_RAM,
  SEARCH_REDUCE_INDEXER_MEMORY_USAGE,
  SEARCH_MAX_INDEXING_THREADS,
  LOG_LEVEL_ENV_VAR,
  BASIC_AUTH_USER_ENV_VAR,
  BASIC_AUTH_PASSWORD_ENV_VAR,
  MEILISEARCH_PATH,
  DISABLE_SEARCH_SNAPSHOT_IN_BACKUP,
  SESSION_CLEANUP_DELAY_SECONDS,
  TONEMAP_ENABLED,
  WEBVTT_SIDECAR_ENABLED,
  DISABLE_VULKAN,
  DISABLE_VAAPI_PAD,
  MOUNT_DEBUG_ENDPOINTS,
  XMLTV_CREDIT_IMAGES_ENABLED,
  SESSION_STALENESS_MS,
  CORS_ORIGINS_ENV_VAR,
} as const;

type RegisteredEnvVar = (typeof TUNARR_ENV_VARS)[keyof typeof TUNARR_ENV_VARS];
export const LOGGER_ENV_PREFIX = 'TUNARR_LOG_LEVEL_' as const;
export type ValidEnvVar =
  | RegisteredEnvVar
  | `${typeof LOGGER_ENV_PREFIX}${string}`;

export function getRawEnvVar(name: ValidEnvVar): Nullable<string> {
  if (BUILD_ENV_KEYS.has(name)) {
    return BUILD_ENV[name] ?? null;
  }
  return process.env[name] ?? null;
}

export function getEnvVar(name: ValidEnvVar): Nullable<string> {
  const val = getRawEnvVar(name);
  return typeof val === 'string' && val.trim().length > 0 ? val : null;
}

export const getNumericEnvVar = (name: ValidEnvVar) => {
  const strValue = getEnvVar(name);
  if (!strValue) return null;
  const parsed = parseInt(strValue);
  return isNaN(parsed) ? null : parsed;
};

export const getBooleanEnvVar = (
  name: ValidEnvVar,
  defaultValue: boolean = true,
) => {
  const strValue = getEnvVar(name);
  if (strValue) {
    return TruthyQueryParam.catch(defaultValue).parse(strValue);
  }
  return defaultValue;
};

export function getFeatureFlagEnvVar(name: string): string | null {
  const registered = Object.values(TUNARR_ENV_VARS).find(
    (value) => value === name,
  );
  if (registered === undefined)
    throw new Error(`Unregistered feature flag env var: ${name}`);
  const value = getRawEnvVar(registered);
  return value === '' ? null : value;
}

export function getLoggerEnvironmentNames(): ValidEnvVar[] {
  return Object.keys(process.env).filter(
    (name): name is `${typeof LOGGER_ENV_PREFIX}${string}` =>
      name.startsWith(LOGGER_ENV_PREFIX),
  );
}
