import type { BreadcrumbsProps } from '@mui/material';
import {
  Breadcrumbs as MUIBreadcrumbs,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useLocation } from '@tanstack/react-router';
import { isEmpty, map, reject } from 'lodash-es';
import { useGetRouteDetails } from '../hooks/useRouteName.ts';
import { RouterLink } from './base/RouterLink.tsx';

export type BreadcrumbTrailItem = { label: string; to?: string };

type Props = BreadcrumbsProps & {
  thisRouteName?: string;
  // Explicit crumbs for layouts whose pages aren't in the route-name table.
  // The last item is the current page and is never a link.
  trail?: BreadcrumbTrailItem[];
};

function PathBreadcrumbs(props: Omit<Props, 'trail'>) {
  const theme = useTheme();
  const smallViewport = useMediaQuery(theme.breakpoints.down('sm'));

  const {
    sx = { mb: 2 },
    separator = '›',
    thisRouteName,
    ...restProps
  } = props;

  const location = useLocation();
  // TODO Hard code this somewhere else
  const pathnames = reject(
    reject(location.pathname.split('/'), isEmpty),
    (part) => part === 'web',
  );
  const getRoute = useGetRouteDetails();
  const MAX_LENGTH = smallViewport ? 20 : 50;

  return (
    <>
      <MUIBreadcrumbs
        sx={sx}
        separator={separator}
        aria-label="channel-breadcrumbs"
        {...restProps}
      >
        {map(pathnames, (_, index) => {
          const isLast = index === pathnames.length - 1;
          const to = `/${pathnames.slice(0, index + 1).join('/')}`;
          const route = getRoute(to);

          if (!route?.name) {
            return null;
          }

          const trimmedText =
            route.name.substring(0, MAX_LENGTH) +
            (route.name.length + 3 >= MAX_LENGTH ? '...' : '');

          // Don't link the last item in a breadcrumb because you are on that page
          // Don't display crumbs for pages that aren't excplicely defined in useRouteNames hook
          return isLast || !route?.isLink ? (
            <Typography color="text.primary" key={to}>
              {thisRouteName ?? trimmedText ?? ''}
            </Typography>
          ) : (
            <RouterLink to={route?.to ?? to} key={to}>
              {trimmedText}
            </RouterLink>
          );
        })}
      </MUIBreadcrumbs>
    </>
  );
}

function TrailBreadcrumbs({
  trail,
  sx = { mb: 2 },
  separator = '›',
  ...restProps
}: BreadcrumbsProps & { trail: BreadcrumbTrailItem[] }) {
  return (
    <MUIBreadcrumbs
      sx={sx}
      separator={separator}
      aria-label="breadcrumbs"
      {...restProps}
    >
      {trail.map((item, index) =>
        index === trail.length - 1 || item.to === undefined ? (
          <Typography color="text.primary" key={`${index}-${item.label}`}>
            {item.label}
          </Typography>
        ) : (
          <RouterLink to={item.to} key={`${index}-${item.label}`}>
            {item.label}
          </RouterLink>
        ),
      )}
    </MUIBreadcrumbs>
  );
}

export default function Breadcrumbs({ trail, ...props }: Props) {
  const { thisRouteName: _name, ...muiProps } = props;
  return trail ? (
    <TrailBreadcrumbs trail={trail} {...muiProps} />
  ) : (
    <PathBreadcrumbs {...props} />
  );
}
