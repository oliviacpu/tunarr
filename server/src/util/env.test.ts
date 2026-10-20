import { FeatureFlagMetadata } from '@tunarr/types';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBooleanEnvVar, getEnvVar, TUNARR_ENV_VARS } from './env.ts';
import { getEnvironmentOverrides } from './environmentOverrides.ts';

vi.mock('../generated/env.js', () => ({
  BUILD_ENV: { TUNARR_EDGE_BUILD: 'false' },
  BUILD_ENV_KEYS: new Set(['TUNARR_EDGE_BUILD']),
}));

afterEach(() => vi.unstubAllEnvs());

describe('environment registry', () => {
  it('uses the same build-time value for boolean parsing as string lookup', () => {
    vi.stubEnv('TUNARR_EDGE_BUILD', 'true');
    expect(getEnvVar(TUNARR_ENV_VARS.IS_EDGE_BUILD_ENV_VAR)).toBe('false');
    expect(getBooleanEnvVar(TUNARR_ENV_VARS.IS_EDGE_BUILD_ENV_VAR)).toBe(false);
  });

  it('registers every feature flag and documents every registered variable', () => {
    const registered = Object.values(TUNARR_ENV_VARS);
    for (const { envVar } of FeatureFlagMetadata)
      expect(registered).toContain(envVar);
    const docs = fs.readFileSync(
      new URL('../../../docs/getting-started/run.md', import.meta.url),
      'utf8',
    );
    for (const name of registered) expect(docs, name).toContain(`\`${name}\``);
    expect(docs).toContain('`TUNARR_LOG_LEVEL_<CLASSNAME>`');
  });

  it('centralizes all runtime process.env reads in env.ts', () => {
    const src = path.resolve(import.meta.dirname, '..');
    const failures: string[] = [];
    for (const entry of fs.readdirSync(src, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith('.ts') ||
        entry.name.includes('.test.') ||
        entry.parentPath.includes(`${path.sep}testing`)
      )
        continue;
      const filename = path.join(entry.parentPath, entry.name);
      if (filename === path.join(import.meta.dirname, 'env.ts')) continue;
      const source = fs.readFileSync(filename, 'utf8');
      const withoutChildProcessInheritance = source.replace(
        /\.\.\.\s*process\s*\.\s*env\b/g,
        '',
      );
      if (/\bprocess\s*\.\s*env\b/.test(withoutChildProcessInheritance))
        failures.push(path.relative(src, filename));
    }
    expect(failures).toEqual([]);
  });
});

it('returns safe parsed environment overrides without secrets or arbitrary variables', () => {
  vi.stubEnv('TUNARR_BASIC_AUTH_PASSWORD', 'do-not-return');
  vi.stubEnv('TUNARR_BASIC_AUTH_USER', 'do-not-return');
  vi.stubEnv('TUNARR_DATABASE_PATH', '/private/config');
  vi.stubEnv('UNRELATED_SECRET', 'do-not-return');
  vi.stubEnv('TUNARR_LOG_LEVEL', 'DEBUG');
  vi.stubEnv('TUNARR_LOG_LEVEL_SERVER', 'warn');
  vi.stubEnv('TUNARR_SCAN_JOB_TIMEOUT_MINUTES', '999999');
  vi.stubEnv('TUNARR_PROXY_ARTWORK', 'false');
  vi.stubEnv('TUNARR_SERVER_PORT', '8123');
  vi.stubEnv('TUNARR_SQLITE_CACHE_KIB', 'invalid');
  vi.stubEnv('DATABASE_DEBUG_LOGGING', 'false');
  const overrides = getEnvironmentOverrides();
  expect(overrides).toMatchObject({
    TUNARR_LOG_LEVEL: 'debug',
    TUNARR_LOG_LEVEL_SERVER: 'warn',
    TUNARR_SCAN_JOB_TIMEOUT_MINUTES: '35791',
    TUNARR_PROXY_ARTWORK: 'false',
    TUNARR_SERVER_PORT: '8123',
    DATABASE_DEBUG_LOGGING: 'true',
  });
  for (const key of [
    'TUNARR_BASIC_AUTH_USER',
    'TUNARR_BASIC_AUTH_PASSWORD',
    'TUNARR_DATABASE_PATH',
    'UNRELATED_SECRET',
    'TUNARR_SQLITE_CACHE_KIB',
  ])
    expect(overrides).not.toHaveProperty(key);
});
