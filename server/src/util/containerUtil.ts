import { getEnvVar, TUNARR_ENV_VARS } from '@/util/env.js';
import { attempt, isError, isUndefined } from 'lodash-es';
import { existsSync, readFileSync } from 'node:fs';
import type { Maybe } from '../types/util.ts';

let isDockerCached: boolean | undefined;
let cachedCgroupContents: Maybe<string>;

const readCgroupSync = () => {
  if (cachedCgroupContents) {
    return cachedCgroupContents;
  }
  cachedCgroupContents = readFileSync('/proc/self/cgroup', 'utf-8');
  return cachedCgroupContents;
};

const hasDockerEnvSync = () => attempt(() => existsSync('/.dockerenv'));
const hasDockerCGroupSync = () => {
  try {
    return readCgroupSync().includes('docker');
  } catch {
    return false;
  }
};

export function isDocker() {
  if (isUndefined(isDockerCached)) {
    const hasEnv = hasDockerEnvSync();
    isDockerCached = !isError(hasEnv) && hasEnv;
    if (!isDockerCached) {
      const hasCgroup = hasDockerCGroupSync();
      isDockerCached = !isError(hasCgroup) && hasCgroup;
    }
  }
  return isDockerCached;
}

export function isPodman() {
  return (
    getEnvVar(TUNARR_ENV_VARS.CONTAINER) === 'podman' ||
    getEnvVar(TUNARR_ENV_VARS.CONTAINER_LOWERCASE) === 'podman' ||
    existsSync('/run/.containerenv') ||
    existsSync('/var/run/.containerenv')
  );
}

function isOtherwiseContainerized() {
  try {
    return readCgroupSync().toLowerCase().includes('containerd');
  } catch {
    return false;
  }
}

export function isRunningInContainer() {
  return isDocker() || isPodman() || isOtherwiseContainerized();
}
