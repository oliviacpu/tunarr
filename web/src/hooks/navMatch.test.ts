import { i18n } from '@lingui/core';
import { describe, expect, test } from 'vitest';
import routeTree from '../routeTree.gen.ts?raw';
import { navItemForPath, topLevelNavItemForPath } from './navMatch.ts';
import { buildNavItems } from './useNavItems.tsx';

i18n.loadAndActivate({ locale: 'en', messages: {} });

const items = buildNavItems(true, null, 0);

// Every fullPath declared in the generated route tree.
const allFullPaths = [
  ...new Set(
    [...routeTree.matchAll(/^\s+fullPath: '([^']+)'/gm)].map((m) => m[1]),
  ),
].filter((p): p is string => p !== undefined);

describe('navItemForPath', () => {
  test('the generated tree was read', () => {
    expect(allFullPaths.length).toBeGreaterThan(30);
  });

  test.each(allFullPaths)('%s maps to a top-level nav item', (fullPath) => {
    expect(topLevelNavItemForPath(items, fullPath)).toBeDefined();
  });

  test.each([
    ['/', '/guide'],
    ['/search', '/library'],
    ['/media/movie/id', '/library'],
    ['/settings/ffmpeg/new', '/settings'],
    ['/settings/scanner', '/settings'],
    ['/system/tasks', '/system'],
    ['/system/troubleshoot', '/system'],
    ['/library/fillers/$fillerId/edit', '/library/fillers'],
    ['/library/custom-shows/$showId/edit', '/library/custom-shows'],
    ['/library', '/library'],
    ['/channels/$channelId/programming/time-slot-editor', '/channels'],
    ['/media_sources/$mediaSourceId', '/media_sources'],
    ['/channels/$channelId/', '/channels'],
  ])('%s highlights %s', (fullPath, expected) => {
    expect(navItemForPath(items, fullPath)?.path).toBe(expected);
  });

  test('matches whole segments only', () => {
    expect(navItemForPath(items, '/channelsX')).toBeUndefined();
  });

  test('top level owner of a child match is the parent', () => {
    expect(topLevelNavItemForPath(items, '/library/trash')?.path).toBe(
      '/library',
    );
  });
});
