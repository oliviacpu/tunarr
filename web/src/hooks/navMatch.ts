export type NavMatchItem<T> = {
  path: string;
  hidden?: boolean;
  children?: readonly T[];
};

const normalize = (path: string) => path.replace(/\/+$/, '');

function isPrefix(prefix: string, fullPath: string) {
  const p = normalize(prefix);
  return fullPath === p || fullPath.startsWith(p + '/');
}

/**
 * The visible nav item (top level or child) whose path is the longest
 * segment-wise prefix of `fullPath`. Drawer and bottom bar share this rule, so
 * detail pages and sub-pages keep their section highlighted.
 */
export function navItemForPath<T extends NavMatchItem<T>>(
  items: readonly T[],
  fullPath: string,
): T | undefined {
  const normalized = normalize(fullPath);
  const target =
    normalized === ''
      ? '/guide'
      : normalized === '/search' || normalized.startsWith('/media/')
        ? '/library'
        : normalized;
  let best: T | undefined;
  let bestLength = -1;
  const visit = (candidates: readonly T[]) => {
    for (const item of candidates) {
      if (!item.hidden) {
        const length = normalize(item.path).length;
        if (isPrefix(item.path, target) && length > bestLength) {
          best = item;
          bestLength = length;
        }
      }
      if (item.children) {
        visit(item.children);
      }
    }
  };
  visit(items);
  return best;
}

/** The top-level item that owns the match, itself or via a child. */
export function topLevelNavItemForPath<T extends NavMatchItem<T>>(
  items: readonly T[],
  fullPath: string,
): T | undefined {
  const match = navItemForPath(items, fullPath);
  if (match === undefined) {
    return undefined;
  }
  return items.find(
    (item) => item === match || (item.children?.includes(match) ?? false),
  );
}
