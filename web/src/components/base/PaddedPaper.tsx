import type { PaperProps } from '@mui/material/Paper';
import Paper from '@mui/material/Paper';
import { styled } from '@mui/material/styles';

const PaddedPaper = styled(Paper, {
  shouldForwardProp: () => true,
})<PaperProps & { to?: string }>(({ theme }) => ({
  padding: theme.spacing(2),
}));

export default PaddedPaper;
