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
