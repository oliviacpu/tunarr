import { t } from '@lingui/core/macro';
import { toasts, withReason } from '@/strings/actions';
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  deleteApiSmartCollectionsByIdMutation,
  getApiSmartCollectionsByIdOptions,
  getApiSmartCollectionsOptions,
  postApiSmartCollectionsMutation,
  putApiSmartCollectionsByIdMutation,
} from '../generated/@tanstack/react-query.gen.ts';
import { invalidateTaggedQueries } from '../helpers/queryUtil.ts';

export const useSmartCollections = () => {
  return useSuspenseQuery({
    ...getApiSmartCollectionsOptions(),
  });
};

export const useSmartCollection = (id: string) => {
  return useSuspenseQuery({
    ...getApiSmartCollectionsByIdOptions({
      path: {
        id,
      },
    }),
  });
};

type MutationCallbacks = {
  onSuccess?: () => void;
};

export const useCreateSmartCollection = (callbacks?: MutationCallbacks) => {
  const snackbar = useSnackbar();
  const queryClient = useQueryClient();
  return useMutation({
    ...postApiSmartCollectionsMutation(),
    onSuccess: () => {
      snackbar.enqueueSnackbar({
        variant: 'success',
        message: toasts.saved(),
      });
      queryClient
        .invalidateQueries({
          predicate: invalidateTaggedQueries('Smart Collections'),
        })
        .catch(console.error)
        .finally(() => callbacks?.onSuccess?.());
    },
    onError: (err) => {
      console.error(err);
      snackbar.enqueueSnackbar({
        variant: 'error',
        message: withReason(
          toasts.couldNotSave(),
          t`Check server logs and browser console for details`,
        ),
      });
    },
  });
};

export const useUpdateSmartCollection = (opts?: MutationCallbacks) => {
  const snackbar = useSnackbar();
  const queryClient = useQueryClient();
  return useMutation({
    ...putApiSmartCollectionsByIdMutation(),
    onSuccess: () => {
      snackbar.enqueueSnackbar({
        variant: 'success',
        message: toasts.saved(),
      });
      queryClient
        .invalidateQueries({
          predicate: invalidateTaggedQueries('Smart Collections'),
        })
        .catch(console.error)
        .finally(() => opts?.onSuccess?.());
    },
    onError: (err) => {
      console.error(err);
      snackbar.enqueueSnackbar({
        variant: 'error',
        message: withReason(
          toasts.couldNotSave(),
          t`Check server logs and browser console for details`,
        ),
      });
    },
  });
};

export const useDeleteSmartCollection = () => {
  const snackbar = useSnackbar();
  const queryClient = useQueryClient();

  return useMutation({
    ...deleteApiSmartCollectionsByIdMutation(),
    onSuccess: () => {
      snackbar.enqueueSnackbar({
        variant: 'success',
        message: toasts.deleted(),
      });
      queryClient
        .invalidateQueries({
          predicate: invalidateTaggedQueries('Smart Collections'),
        })
        .catch(console.error);
    },
    onError: (err) => {
      console.error(err);
      snackbar.enqueueSnackbar({
        variant: 'error',
        message: withReason(
          toasts.couldNotDelete(),
          t`Check server logs and browser console for details`,
        ),
      });
    },
  });
};
