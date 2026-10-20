import { getFeatureFlagEnvVar } from '@/util/env.js';
import type { ISettingsDB } from '@/db/interfaces/ISettingsDB.js';
import { KEYS } from '@/types/inject.js';
import { TruthyQueryParam } from '@/types/schemas.js';
import type { FeatureFlagKey, FeatureFlags } from '@tunarr/types';
import { FeatureFlagMetadata } from '@tunarr/types';
import { inject, injectable } from 'inversify';

/**
 * Resolve a feature flag from environment variables only (no settings DB).
 * Used as the default resolver in pipeline builders which may be constructed
 * outside of the DI container (e.g. in tests using vi.stubEnv).
 */
export function resolveFeatureFlagFromEnv(flag: FeatureFlagKey): boolean {
  const meta = FeatureFlagMetadata.find((m) => m.key === flag);
  if (meta) {
    const envValue = getFeatureFlagEnvVar(meta.envVar);
    if (envValue !== null) {
      return TruthyQueryParam.catch(false).parse(envValue);
    }
  }
  return false;
}

@injectable()
export class FeatureFlagService {
  constructor(@inject(KEYS.SettingsDB) private settings: ISettingsDB) {}

  get(flag: FeatureFlagKey): boolean {
    const envResult = resolveFeatureFlagFromEnv(flag);
    const meta = FeatureFlagMetadata.find((m) => m.key === flag);
    if (meta) {
      const envValue = getFeatureFlagEnvVar(meta.envVar);
      if (envValue !== null) {
        return envResult;
      }
    }
    return this.settings.featureFlags()[flag];
  }

  getAll(): FeatureFlags {
    const persisted = { ...this.settings.featureFlags() };
    for (const meta of FeatureFlagMetadata) {
      const envValue = getFeatureFlagEnvVar(meta.envVar);
      if (envValue !== null) {
        persisted[meta.key] = TruthyQueryParam.catch(false).parse(envValue);
      }
    }
    return persisted;
  }

  getEnvOverrides(): Partial<Record<FeatureFlagKey, boolean>> {
    const result: Partial<Record<FeatureFlagKey, boolean>> = {};
    for (const meta of FeatureFlagMetadata) {
      const envValue = getFeatureFlagEnvVar(meta.envVar);
      if (envValue !== null) {
        result[meta.key] = true;
      }
    }
    return result;
  }
}
