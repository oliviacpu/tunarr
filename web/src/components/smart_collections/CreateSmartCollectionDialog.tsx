import { useActions, useToasts, withReason } from '@/strings/actions';
import { Trans, useLingui } from '@lingui/react/macro';
import { Save } from '@mui/icons-material';
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { search } from '@tunarr/shared/util';
import type { SearchFilter } from '@tunarr/types/schemas';
import { isEmpty } from 'lodash-es';
import { useSnackbar } from 'notistack';
import { useCallback } from 'react';
import type { FieldErrors } from 'react-hook-form';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  useCreateSmartCollection,
  useSmartCollections,
  useUpdateSmartCollection,
} from '../../hooks/smartCollectionHooks.ts';

type Props = {
  onClose: () => void;
  onSaved?: () => void;
  initialQuery: {
    filter?: SearchFilter;
    keywords?: string;
  };
};

type SmartCollectionForm = {
  name: string;
  id: string;
  filter: SearchFilter;
  keywords: string;
};

export const CreateSmartCollectionDialog = ({
  onClose,
  onSaved,
  initialQuery,
}: Props) => {
  const { t } = useLingui();
  const actions = useActions();
  const toasts = useToasts();
  const { data: existingCollections } = useSmartCollections();
  const snackbar = useSnackbar();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<SmartCollectionForm>({
    mode: 'all',
    defaultValues: {
      name: '',
      filter: initialQuery?.filter,
      keywords: initialQuery?.keywords ?? '',
      id: 'new',
    },
  });
  const insertSmartCollection = useCreateSmartCollection({
    onSuccess: () => {
      onClose();
      onSaved?.();
    },
  });

  const updateSmartCollection = useUpdateSmartCollection({
    onSuccess: () => {
      onClose();
      onSaved?.();
    },
  });

  const [existingId] = useWatch({ control, name: ['id'] });
  const saving =
    insertSmartCollection.isPending || updateSmartCollection.isPending;

  const saveSmartCollection = useCallback(
    (values: SmartCollectionForm) => {
      if (values.id === 'new') {
        insertSmartCollection.mutate({
          body: {
            name: values.name,
            filter: values.filter,
            keywords: values.keywords,
          },
          throwOnError: true,
        });
      } else {
        updateSmartCollection.mutate({
          path: {
            id: values.id,
          },
          body: {
            filter: values.filter ?? { type: 'op', op: 'and', children: [] },
            keywords: values.keywords ?? '',
          },
        });
      }
    },
    [insertSmartCollection, updateSmartCollection],
  );

  const handleError = useCallback(
    (errors: FieldErrors) => {
      console.error(errors);
      snackbar.enqueueSnackbar({
        variant: 'error',
        message: withReason(
          toasts.couldNotSave,
          t`Check server logs and browser console for details`,
        ),
      });
    },
    [snackbar, t, toasts],
  );

  return (
    <>
      <DialogTitle>
        <Trans>Save Smart Collection</Trans>
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ pt: 1 }}>
          <Controller
            control={control}
            name="id"
            render={({ field }) => {
              const existingFilter = existingCollections.find(
                (coll) => coll.uuid === field.value,
              )?.filter;
              const filterString = existingFilter
                ? search.searchFilterToString(existingFilter)
                : '';
              return (
                <FormControl>
                  <Select
                    disabled={saving || existingCollections.length === 0}
                    {...field}
                    value={field.value ? field.value : 'new'}
                  >
                    {existingCollections.map((coll) => (
                      <MenuItem key={coll.uuid} value={coll.uuid}>
                        {coll.name}
                      </MenuItem>
                    ))}
                    <MenuItem value="new">
                      <Trans>Save as new collection&hellip;</Trans>
                    </MenuItem>
                  </Select>
                  <FormHelperText>
                    {field.value === 'new'
                      ? t`Creates a new collection`
                      : t`Existing query: ${filterString}`}
                  </FormHelperText>
                </FormControl>
              );
            }}
          />
          {(isEmpty(existingId) || existingId === 'new') && (
            <Controller
              name="name"
              control={control}
              rules={{
                required: true,
                minLength: 1,
              }}
              render={({ field }) => (
                <TextField disabled={saving} label={t`Name`} {...field} />
              )}
            />
          )}
          <Controller
            name="keywords"
            control={control}
            render={({ field }) => (
              <TextField disabled label={t`Keywords`} {...field} />
            )}
          />
          <Controller
            name="filter"
            control={control}
            render={({ field }) => (
              <TextField
                disabled
                label={t`Filter`}
                {...field}
                value={
                  field.value ? search.searchFilterToString(field.value) : ''
                }
              />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={() => onClose()}>
          {actions.cancel}
        </Button>
        <Button
          variant="contained"
          disabled={!isValid || saving}
          loading={saving}
          startIcon={<Save />}
          onClick={handleSubmit(saveSmartCollection, handleError)}
        >
          {actions.save}
        </Button>
      </DialogActions>
    </>
  );
};
