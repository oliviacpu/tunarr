import { isUndefined } from 'lodash-es';
import path from 'node:path';
import { globalOptions } from '../globals.ts';
import { isRunningInContainer } from './containerUtil.ts';
import {
  DATABASE_LOCATION_ENV_VAR,
  getEnvVar,
  TUNARR_ENV_VARS,
} from './env.ts';
import { isNonEmptyString } from './index.js';
import type { LogLevels } from './logging/LoggerFactory.ts';
import { getEnvironmentLogLevel } from './logging/LoggerFactory.ts';

function getRuntimeSpecificPrefix(): string {
  let prefix: string;
  if (isRunningInContainer()) {
    // Making a lot of assumptions here...
    prefix = '/config';
  } else if (getEnvVar(TUNARR_ENV_VARS.APPDATA)) {
    prefix = `${getEnvVar(TUNARR_ENV_VARS.APPDATA)}`;
  } else if (process.platform === 'darwin') {
    prefix = `${getEnvVar(TUNARR_ENV_VARS.HOME)}/Library/Preferences`;
  } else {
    prefix = `${getEnvVar(TUNARR_ENV_VARS.HOME)}/.local/share`;
  }
  return prefix;
}

export function getDefaultLogLevel(useEnvVar: boolean = true): LogLevels {
  if (useEnvVar) {
    const level = getEnvironmentLogLevel();
    if (!isUndefined(level)) {
      return level;
    }
  }

  return 'info';
}

export function getDefaultDatabaseDirectory(): string {
  const env = getEnvVar(DATABASE_LOCATION_ENV_VAR);
  if (isNonEmptyString(env)) {
    return env;
  }

  const prefix = getRuntimeSpecificPrefix();

  return path.join(prefix, 'tunarr');
}

export function getDefaultDatabaseName() {
  return path.join(
    globalOptions().databaseDirectory,
    getEnvVar(TUNARR_ENV_VARS.DATABASE_NAME) ?? 'db.db',
  );
}
