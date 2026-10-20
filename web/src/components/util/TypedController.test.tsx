import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, test } from 'vitest';
import { NumericFormControllerText } from './TypedController.tsx';

function Harness({
  validate,
}: {
  validate: (value: number) => string | undefined;
}): ReactNode {
  const { control } = useForm<{ hours: number }>({
    defaultValues: { hours: 1 },
    mode: 'onBlur',
  });
  return (
    <NumericFormControllerText
      control={control}
      name="hours"
      prettyFieldName="Hours"
      rules={{ validate }}
      TextFieldProps={{ id: 'hours', label: 'Hours' }}
    />
  );
}

async function enter(
  validate: (value: number) => string | undefined,
  value: string,
) {
  const { user } = renderWithProviders(<Harness validate={validate} />);
  const field = screen.getByLabelText('Hours');
  await user.clear(field);
  await user.type(field, value);
  await user.tab();
  await waitFor(() => expect(field).toBeInvalid());
  return field;
}

describe('NumericFormControllerText with its own validate', () => {
  test('still checks that the value is a number', async () => {
    const field = await enter(() => undefined, 'abc');

    expect(field).toHaveAccessibleDescription('Hours should be numeric.');
  });

  test("runs the caller's check", async () => {
    const field = await enter(
      (value) => (value > 10 ? 'At most 10' : undefined),
      '11',
    );

    expect(field).toHaveAccessibleDescription('At most 10');
  });

  test("shows the caller's message when both fail", async () => {
    const field = await enter(
      (value) => (isNaN(value) ? 'Not a valid number' : undefined),
      'abc',
    );

    expect(field).toHaveAccessibleDescription('Not a valid number');
  });
});

function HarnessWithHelp(): ReactNode {
  const { control } = useForm<{ tuners: number }>({
    defaultValues: { tuners: 2 },
    mode: 'onBlur',
  });
  return (
    <NumericFormControllerText
      control={control}
      name="tuners"
      prettyFieldName="Tuners"
      rules={{ min: 1 }}
      TextFieldProps={{
        id: 'tuners',
        label: 'Tuners',
        helperText: 'How many at once.',
      }}
    />
  );
}

describe('NumericFormControllerText with help text', () => {
  test('a rule without its own message still says what is wrong', async () => {
    const { user } = renderWithProviders(<HarnessWithHelp />);
    const field = screen.getByLabelText('Tuners');
    expect(field).toHaveAccessibleDescription('How many at once.');

    await user.clear(field);
    await user.type(field, '0');
    await user.tab();

    await waitFor(() => expect(field).toBeInvalid());
    expect(field).toHaveAccessibleDescription(
      expect.stringMatching(/^Tuners must be >= 1\s*How many at once\.$/),
    );
  });
});
