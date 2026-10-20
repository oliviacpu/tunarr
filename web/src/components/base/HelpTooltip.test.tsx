import { renderWithProviders, screen } from '@/test/utils';
import { FormControlLabel, FormHelperText, Switch } from '@mui/material';
import { describe, expect, test } from 'vitest';
import { HelpTooltip } from './HelpTooltip.tsx';

describe('HelpTooltip', () => {
  test('shows the longer explanation on keyboard focus', async () => {
    const { user } = renderWithProviders(
      <FormHelperText>
        One line of help.
        <HelpTooltip about="Tuner count">The rest of the story.</HelpTooltip>
      </FormHelperText>,
    );

    const icon = screen.getByRole('button', { name: 'More about Tuner count' });
    expect(
      screen.queryByText('The rest of the story.'),
    ).not.toBeInTheDocument();

    await user.tab();
    expect(icon).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'The rest of the story.',
    );
    // Described, not renamed, by the tooltip
    expect(icon).toHaveAccessibleName('More about Tuner count');
    expect(icon).toHaveAccessibleDescription('The rest of the story.');
  });

  test('beside a switch, clicking it leaves the switch alone', async () => {
    const { user } = renderWithProviders(
      <>
        <FormControlLabel control={<Switch />} label="Network discovery" />
        <HelpTooltip about="Network discovery">More.</HelpTooltip>
      </>,
    );

    await user.click(
      screen.getByRole('button', { name: 'More about Network discovery' }),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Network discovery' }),
    ).not.toBeChecked();
  });
});
