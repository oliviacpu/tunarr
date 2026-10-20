import { t } from '@lingui/core/macro';
import type { CircularProgressProps } from '@mui/material';
import { CircularProgress } from '@mui/material';
import { styled } from '@mui/material/styles';

// Sized like an SvgIcon: 1.5rem, drawn 1em wide. A button's startIcon sets a
// smaller font size on its icon, and that wins over this, as it does for icons.
const Spinner = styled(CircularProgress)({
  fontSize: '1.5rem',
  verticalAlign: 'middle',
});

// The app's one inline spinner. It can stand in for an icon: in a button's
// startIcon, an input adornment or a table cell. Pass `size` for a larger,
// page-level spinner.
export function LoadingIcon({
  size = '1em',
  color = 'inherit',
  ...props
}: CircularProgressProps) {
  return (
    <Spinner size={size} color={color} aria-label={t`Loading`} {...props} />
  );
}
