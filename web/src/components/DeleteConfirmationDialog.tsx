import { useActions } from '@/strings/actions';
import type { DialogProps } from '@mui/material';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

type Props = {
  open: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  onClose: () => void;
  title: string;
  body?: string;
  /** Text of the confirm button. Defaults to "Delete". */
  confirmLabel?: string;
  dialogProps?: Omit<DialogProps, 'open' | 'onClose'>;
};

type ContentProps = {
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  onCancel?: () => void;
};

const DeleteConfirmationDialogContent = ({
  title,
  body,
  confirmLabel,
  onClose,
  onCancel,
  onConfirm,
}: ContentProps) => {
  const actions = useActions();
  const confirm = () => {
    onConfirm();
    onClose();
  };
  const cancel = () => {
    onCancel?.();
    onClose();
  };

  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      {body && (
        <DialogContent>
          <DialogContentText>{body}</DialogContentText>
        </DialogContent>
      )}
      <DialogActions>
        <Button onClick={() => cancel()}>{actions.cancel}</Button>
        <Button variant="contained" color="error" onClick={() => confirm()}>
          {confirmLabel ?? actions.delete}
        </Button>
      </DialogActions>
    </>
  );
};

export const DeleteConfirmationDialog = (props: Props) => {
  const { open, onClose, dialogProps } = props;

  return (
    <Dialog open={open} onClose={() => onClose()} {...dialogProps}>
      <DeleteConfirmationDialogContent {...props} />
    </Dialog>
  );
};
