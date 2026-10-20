import { useActions } from '@/strings/actions';
import type { DialogProps } from '@mui/material';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  onClose: () => void;
  /** Names the thing being deleted, e.g. "Delete Evening Movies?". */
  title: string;
  /** One sentence stating the consequence. */
  body?: string;
  /** Extra detail shown under the body, such as what references the item. */
  details?: ReactNode;
  /** Text of the confirm button: the verb. Defaults to "Delete". */
  confirmLabel?: string;
  /**
   * True while the delete is running: the confirm button shows a spinner and
   * both buttons are disabled, and the dialog can't be dismissed. Pair it
   * with `closeOnConfirm={false}`, otherwise the dialog closes on confirm and
   * the spinner is never seen.
   */
  busy?: boolean;
  /**
   * Whether confirming also calls `onClose`. Defaults to true. Pass false to
   * keep the dialog open while the delete runs (with `busy`); the caller then
   * closes it when the mutation settles.
   */
  closeOnConfirm?: boolean;
  dialogProps?: Omit<DialogProps, 'open' | 'onClose'>;
};

type ContentProps = Omit<Props, 'open' | 'dialogProps'>;

const DeleteConfirmationDialogContent = ({
  title,
  body,
  details,
  confirmLabel,
  busy = false,
  closeOnConfirm = true,
  onClose,
  onCancel,
  onConfirm,
}: ContentProps) => {
  const actions = useActions();
  const confirm = () => {
    onConfirm();
    if (closeOnConfirm) {
      onClose();
    }
  };
  const cancel = () => {
    onCancel?.();
    onClose();
  };

  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      {(body || details) && (
        <DialogContent>
          {body && <DialogContentText>{body}</DialogContentText>}
          {details}
        </DialogContent>
      )}
      <DialogActions>
        <Button variant="outlined" disabled={busy} onClick={() => cancel()}>
          {actions.cancel}
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={busy}
          startIcon={
            busy ? <CircularProgress size={16} color="inherit" /> : null
          }
          onClick={() => confirm()}
        >
          {confirmLabel ?? actions.delete}
        </Button>
      </DialogActions>
    </>
  );
};

export const DeleteConfirmationDialog = (props: Props) => {
  const { open, onClose, dialogProps, busy } = props;

  return (
    <Dialog
      open={open}
      // The dialog is a React child of whatever rendered it, such as a
      // clickable table row; its clicks must not reach that parent.
      onClick={(e) => e.stopPropagation()}
      onClose={() => {
        if (busy !== true) {
          onClose();
        }
      }}
      {...dialogProps}
    >
      <DeleteConfirmationDialogContent {...props} />
    </Dialog>
  );
};
