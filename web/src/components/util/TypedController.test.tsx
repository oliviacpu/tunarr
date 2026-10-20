import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, test, vi } from 'vitest';
import {
  NumericFormControllerText,
  SelectFormController,
  SwitchFormController,
} from './TypedController.tsx';

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

function RawValueHarness({
  onSubmit,
}: {
  onSubmit: (values: { rate: number | string }) => void;
}): ReactNode {
  const { control, handleSubmit } = useForm<{ rate: number | string }>({
    defaultValues: { rate: 48 },
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <NumericFormControllerText
        control={control}
        name="rate"
        rawValue
        TextFieldProps={{ id: 'rate', label: 'Sample rate' }}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe('NumericFormControllerText with rawValue', () => {
  test.each([
    ['44.1', '44.1'],
    ['', ''],
    ['-23.5', '-23.5'],
  ])('keeps %j as typed for the resolver to read', async (typed, kept) => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(
      <RawValueHarness onSubmit={onSubmit} />,
    );
    const field = screen.getByLabelText('Sample rate');

    await user.clear(field);
    if (typed !== '') {
      await user.type(field, typed);
    }
    expect(field).toHaveValue(kept);
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({ rate: kept });
  });

  test('still says a value that is not a number is wrong without a resolver', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(
      <RawValueHarness onSubmit={onSubmit} />,
    );
    const field = screen.getByLabelText('Sample rate');

    await user.clear(field);
    await user.type(field, '44k');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(field).toHaveAccessibleDescription('rate should be numeric.'),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

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

type SwitchValues = { discovery: boolean };

function SwitchHarness({
  onSubmit,
  disabled,
  helperText,
}: {
  onSubmit: (values: SwitchValues) => void;
  disabled?: boolean;
  helperText?: ReactNode;
}): ReactNode {
  const { control, handleSubmit } = useForm<SwitchValues>({
    defaultValues: { discovery: true },
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <SwitchFormController
        control={control}
        name="discovery"
        label="Network discovery"
        helperText={helperText}
        disabled={disabled}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe('SwitchFormController', () => {
  test('shows the field as a labelled switch with its help text', () => {
    renderWithProviders(
      <SwitchHarness
        onSubmit={() => {}}
        helperText="Announces Tunarr on your network."
      />,
    );

    const toggle = screen.getByRole('checkbox', { name: 'Network discovery' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(
      'Announces Tunarr on your network.',
    );
  });

  test('has no description without help text', () => {
    renderWithProviders(<SwitchHarness onSubmit={() => {}} />);

    expect(
      screen.getByRole('checkbox', { name: 'Network discovery' }),
    ).not.toHaveAccessibleDescription();
  });

  test('turning it off stores false', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(<SwitchHarness onSubmit={onSubmit} />);

    await user.click(
      screen.getByRole('checkbox', { name: 'Network discovery' }),
    );
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ discovery: false });
  });

  test('a disabled switch still submits its value', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(
      <SwitchHarness onSubmit={onSubmit} disabled />,
    );

    expect(
      screen.getByRole('checkbox', { name: 'Network discovery' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ discovery: true });
  });
});

type SelectValues = { hour: number; format: 'mkv' | 'mp4' };

const hourOptions = [
  { value: 0, label: '00:00' },
  { value: 5, label: '05:00' },
  { value: 23, label: '23:00' },
];

const formatOptions = [
  { value: 'mkv', label: 'MKV' },
  { value: 'mp4', label: 'MP4' },
  { value: 'avi', label: 'AVI', disabled: true },
] as const;

function SelectHarness({
  onSubmit,
}: {
  onSubmit: (values: SelectValues) => void;
}): ReactNode {
  const { control, handleSubmit } = useForm<SelectValues>({
    defaultValues: { hour: 0, format: 'mkv' },
    mode: 'onChange',
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <SelectFormController
        control={control}
        name="hour"
        label="Refreshes start at"
        helperText="An hour in server time."
        options={hourOptions}
        rules={{
          validate: (hour) => hour !== 23 || 'Too late for a rebuild',
        }}
      />
      <SelectFormController
        control={control}
        name="format"
        label="Output format"
        options={formatOptions}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe('SelectFormController', () => {
  test('shows the field as a labelled select with its help text', () => {
    renderWithProviders(<SelectHarness onSubmit={() => {}} />);

    const select = screen.getByRole('combobox', { name: 'Refreshes start at' });
    expect(select).toHaveTextContent('00:00');
    expect(select).toHaveAccessibleDescription('An hour in server time.');
  });

  test("picking an option stores the option's value, keeping its type", async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(<SelectHarness onSubmit={onSubmit} />);

    await user.click(
      screen.getByRole('combobox', { name: 'Refreshes start at' }),
    );
    await user.click(await screen.findByRole('option', { name: '05:00' }));
    await user.click(screen.getByRole('combobox', { name: 'Output format' }));
    await user.click(await screen.findByRole('option', { name: 'MP4' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
      hour: 5,
      format: 'mp4',
    });
  });

  test('a field error replaces the help text', async () => {
    const { user } = renderWithProviders(<SelectHarness onSubmit={() => {}} />);
    const select = () =>
      screen.getByRole('combobox', { name: 'Refreshes start at' });

    await user.click(select());
    await user.click(await screen.findByRole('option', { name: '23:00' }));

    await waitFor(() =>
      expect(select()).toHaveAccessibleDescription('Too late for a rebuild'),
    );
  });

  test('a disabled option is listed but cannot be picked', async () => {
    const { user } = renderWithProviders(<SelectHarness onSubmit={() => {}} />);

    await user.click(screen.getByRole('combobox', { name: 'Output format' }));
    const avi = await screen.findByRole('option', { name: 'AVI' });
    expect(avi).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'MP4' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});
