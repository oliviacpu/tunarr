import type { router } from '@/router.ts';
import { t } from '@lingui/core/macro';
import {
  Computer,
  Delete,
  Home,
  Preview,
  Psychology,
  Settings,
  SettingsRemote,
  Storage as StorageIcon,
  Theaters,
  Tv,
  VideoLibrary,
} from '@mui/icons-material';
import type { BadgeProps } from '@mui/material';
import { useRouterState } from '@tanstack/react-router';
import { countBy, last, trimEnd } from 'lodash-es';
import { useMemo, type ReactNode } from 'react';
import useStore from '../store/index.ts';
import { navItemForPath } from './navMatch.ts';
import { useSystemHealthChecks } from './useSystemHealthChecks.ts';

function setSelected(navItems: NavItem[], selected: NavItem | undefined) {
  for (const item of navItems) {
    item.selected = item === selected;
    if (item.children) {
      setSelected(item.children, selected);
    }
  }
}

export function buildNavItems(
  showWelcome: boolean,
  highestSev: 'error' | 'warning' | null,
  sevCount: number,
): NavItem[] {
  const items: NavItem[] = [
    {
      name: t`Welcome`,
      path: '/welcome',
      hidden: !showWelcome,
      icon: <Home />,
    },
    { name: t`Guide`, path: '/guide', icon: <Tv /> },
    {
      name: t`Channels`,
      path: '/channels',
      icon: <SettingsRemote />,
    },
    // { name: 'Watch', path: '/watch', hidden: true, icon: <LiveTv /> },
    {
      name: t`Library`,
      path: '/library',
      icon: <VideoLibrary />,
      children: [
        {
          name: t`Filler Lists`,
          path: '/library/fillers',
          icon: <Preview />,
        },
        {
          name: t`Smart Collections`,
          path: '/library/smart_collections',
          icon: <Psychology />,
        },
        {
          name: t`Custom Shows`,
          path: '/library/custom-shows' as const,
          icon: <Theaters />,
        },
        {
          name: t`Trash`,
          path: '/library/trash',
          icon: <Delete />,
        },
      ],
    },
    {
      name: t`Sources`,
      path: '/media_sources',
      icon: <StorageIcon />,
    },
    {
      name: t`System`,
      path: '/system',
      icon: <Computer />,
      badge: highestSev
        ? {
            count: sevCount,
            color: highestSev === 'error' ? 'error' : 'warning',
          }
        : undefined,
    },
    {
      name: t`Settings`,
      path: '/settings',
      icon: <Settings />,
    },
  ];

  return items;
}

export const useNavItems = () => {
  const showWelcome = useStore((state) => state.theme.showWelcome);
  const routerState = useRouterState({
    select: ({ matches }) => trimEnd(last(matches)?.fullPath ?? '', '/'),
  });
  const { data: healthChecks } = useSystemHealthChecks();
  const [highestSev, sevCount] = useMemo(() => {
    if (!healthChecks) {
      return [null, 0];
    }
    const countBySev = countBy(Object.values(healthChecks), ({ type }) => type);

    if (countBySev['error'] && countBySev['error'] > 0) {
      return ['error', countBySev['error']] as const;
    } else if (countBySev['warning'] && countBySev['warning'] > 0) {
      return ['warning', countBySev['warning']] as const;
    }

    return [null, 0];
  }, [healthChecks]);

  return useMemo<NavItem[]>(() => {
    const items = buildNavItems(showWelcome, highestSev, sevCount);
    setSelected(items, navItemForPath(items, routerState));
    return items;
  }, [highestSev, routerState, sevCount, showWelcome]);
};

export interface NavItem {
  name: string;
  path: keyof (typeof router)['routesByPath'];
  hidden?: boolean;
  children?: NavItem[];
  icon?: ReactNode;
  copyToClipboard?: boolean;
  selected?: boolean;
  badge?: {
    count: number;
    color: BadgeProps['color'];
    forChild?: boolean;
  };
}
