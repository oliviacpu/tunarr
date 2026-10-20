import { renderWithProviders, screen } from '@/test/utils';
import { describe, expect, test } from 'vitest';
import { LoadingIcon } from './LoadingIcon.tsx';

describe('LoadingIcon', () => {
  test('is a labelled progress indicator the size of an icon', () => {
    renderWithProviders(<LoadingIcon />);

    const spinner = screen.getByRole('progressbar', { name: 'Loading' });
    expect(spinner).toHaveStyle({ width: '1em', height: '1em' });
  });

  test('takes a size for page-level loading', () => {
    renderWithProviders(<LoadingIcon size={40} />);

    expect(screen.getByRole('progressbar')).toHaveStyle({
      width: '40px',
      height: '40px',
    });
  });
});
