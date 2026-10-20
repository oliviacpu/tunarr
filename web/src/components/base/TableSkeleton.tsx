import { t } from '@lingui/core/macro';
import {
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { range } from 'lodash-es';

type Props = {
  // The number of columns the loaded table shows by default
  columns: number;
  rows?: number;
};

// Stands in for a list table while its rows load, shaped like the table so the
// page doesn't jump when the data arrives. List routes use it as their
// pendingComponent.
export function TableSkeleton({ columns, rows = 5 }: Props) {
  return (
    <TableContainer
      component={Paper}
      aria-busy="true"
      aria-label={t`Loading`}
      data-testid="table-skeleton"
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            {range(columns).map((column) => (
              <TableCell key={column}>
                <Skeleton variant="text" width="60%" />
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {range(rows).map((row) => (
            <TableRow key={row}>
              {range(columns).map((column) => (
                <TableCell key={column}>
                  <Skeleton variant="text" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
