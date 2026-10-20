import { describe, expect, test, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/utils';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';

describe('DeleteConfirmationDialog', () => {
  test('renders title and body', () => {
    renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Delete Item"
        body="Are you sure you want to delete this item?"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(
      screen.getByText('Are you sure you want to delete this item?'),
    ).toBeInTheDocument();
  });

  test('delete button calls onConfirm then onClose', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const { user } = renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Confirm Delete"
        body="This action cannot be undone."
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    await user.click(deleteButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // onConfirm should be called before onClose
    expect(onConfirm.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0],
    );
  });

  test('confirm button reads confirmLabel when given', async () => {
    const onConfirm = vi.fn();

    const { user } = renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Empty the trash?"
        confirmLabel="Empty trash"
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Delete' }),
    ).not.toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Empty trash' });
    expect(confirmButton).toHaveClass('MuiButton-colorError');
    await user.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('cancel button calls onCancel (if provided) then onClose', async () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();

    const { user } = renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Confirm Delete"
        onConfirm={() => {}}
        onCancel={onCancel}
        onClose={onClose}
      />,
    );

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('cancel button only calls onClose when onCancel not provided', async () => {
    const onClose = vi.fn();

    const { user } = renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Confirm Delete"
        onConfirm={() => {}}
        onClose={onClose}
      />,
    );

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('body is optional - does not render DialogContent if missing', () => {
    renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Delete Without Body"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('Delete Without Body')).toBeInTheDocument();
    // Should have title and buttons but no body content
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
  });

  test('does not render when open is false', () => {
    renderWithProviders(
      <DeleteConfirmationDialog
        open={false}
        title="Hidden Dialog"
        body="Should not be visible"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText('Hidden Dialog')).not.toBeInTheDocument();
  });

  test('passes dialogProps to Dialog component', () => {
    renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="With Props"
        onConfirm={() => {}}
        onClose={() => {}}
        dialogProps={{ maxWidth: 'sm', fullWidth: true }}
      />,
    );

    expect(screen.getByText('With Props')).toBeInTheDocument();
  });

  test('states the consequence and any details under the title', () => {
    renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Delete Evening Movies?"
        body="This removes it from every channel."
        details={<p>Used by 2 channels</p>}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Delete Evening Movies?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This removes it from every channel.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Used by 2 channels')).toBeInTheDocument();
  });

  test('cancel is outlined and confirm is contained and error-coloured', () => {
    renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Delete it?"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass(
      'MuiButton-outlined',
    );
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveClass('MuiButton-contained');
    expect(confirm).toHaveClass('MuiButton-colorError');
  });

  test('busy disables both buttons, shows a spinner and blocks dismissal', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const { user } = renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Delete it?"
        busy
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('not busy shows no spinner and escape closes', async () => {
    const onClose = vi.fn();

    const { user } = renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Delete it?"
        onConfirm={() => {}}
        onClose={onClose}
      />,
    );

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicks inside the dialog do not reach a clickable ancestor', async () => {
    const rowClick = vi.fn();

    const { user } = renderWithProviders(
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
      <div onClick={rowClick}>
        <DeleteConfirmationDialog
          open={true}
          title="Delete it?"
          onConfirm={() => {}}
          onClose={() => {}}
        />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(rowClick).not.toHaveBeenCalled();
  });

  test('closeOnConfirm false calls onConfirm and leaves closing to the caller', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const { user } = renderWithProviders(
      <DeleteConfirmationDialog
        open={true}
        title="Delete it?"
        closeOnConfirm={false}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
