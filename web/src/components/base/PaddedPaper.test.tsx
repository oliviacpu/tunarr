import { Theme } from '@/theme.ts';
import { ThemeProvider, createTheme } from '@mui/material';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PaddedPaper from './PaddedPaper.tsx';

describe('PaddedPaper', () => {
  it('pads by theme.spacing(2)', () => {
    render(
      <ThemeProvider theme={Theme}>
        <PaddedPaper data-testid="paper">content</PaddedPaper>
      </ThemeProvider>,
    );

    expect(screen.getByTestId('paper')).toHaveStyle({
      padding: Theme.spacing(2),
    });
  });

  it('follows the theme spacing rather than a fixed size', () => {
    const narrow = createTheme({ spacing: 4 });
    render(
      <ThemeProvider theme={narrow}>
        <PaddedPaper data-testid="paper">content</PaddedPaper>
      </ThemeProvider>,
    );

    expect(narrow.spacing(2)).toBe('8px');
    expect(screen.getByTestId('paper')).toHaveStyle({ padding: '8px' });
  });
});
