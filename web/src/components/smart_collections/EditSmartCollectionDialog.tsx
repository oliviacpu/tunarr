import { useActions } from '@/strings/actions';
import { Trans, useLingui } from '@lingui/react/macro';
import { Save } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { isNonEmptyString, search } from '@tunarr/shared/util';
import type { SearchFilter } from '@tunarr/types/schemas';
import { useEffect, useRef } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import { getApiSmartCollectionsByIdOptions } from '../../generated/@tanstack/react-query.gen.ts';
import { useSearchQueryParser } from '../../hooks/useSearchQueryParser.ts';
import { useUpdateSmartCollection } from '../../hooks/smartCollectionHooks.ts';
import { SearchFilterBuilder } from '../search/SearchFilterBuilder.tsx';
import type { SearchForm } from '../search/SearchInput.tsx';

type Props = {
  id: string;
  onClose: () => void;
};

type CollectionForm = SearchForm & { name: string };

export const EditSmartCollectionDialog = ({ id, onClose }: Props) => {
  const { t } = useLingui();
  const actions = useActions();
  const loadedId = useRef<string | undefined>(undefined);
  const { parseToSearchFilterOrNull } = useSearchQueryParser();
  const {
    data: smartCollection,
    isLoading,
    isError,
  } = useQuery({
    ...getApiSmartCollectionsByIdOptions({ path: { id } }),
    enabled: isNonEmptyString(id),
  });
  const form = useForm<CollectionForm>({
    mode: 'onChange',
    defaultValues: {
      name: '',
      keywords: '',
      filter: { type: 'text', expression: '' },
      queryBuilderType: 'text',
    },
  });
  const {
    reset,
    control,
    formState: { isValid, isDirty },
  } = form;

  useEffect(() => {
    if (
      smartCollection &&
      (loadedId.current !== smartCollection.uuid || !isDirty)
    ) {
      reset({
        name: smartCollection.name,
        keywords: smartCollection.keywords,
        filter: {
          type: 'text',
          expression:
            smartCollection.filterString ??
            (smartCollection.filter
              ? search.searchFilterToString(smartCollection.filter)
              : ''),
        },
        queryBuilderType: 'text',
      });
      loadedId.current = smartCollection.uuid;
    }
  }, [reset, smartCollection, isDirty]);

  const updateSmartCollection = useUpdateSmartCollection({
    onSuccess: onClose,
  });
  const saving = updateSmartCollection.isPending;

  const handleSave = (values: CollectionForm) => {
    let filter: SearchFilter;
    if (values.filter.type === 'structured') {
      filter = values.filter.filter;
    } else {
      const parsed = parseToSearchFilterOrNull(values.filter.expression);
      if (isNonEmptyString(values.filter.expression) && parsed === null) {
        form.setError('filter.expression', { type: 'validExpression' });
        return;
      }
      // The existing API accepts an empty group and stores its empty expression.
      filter = parsed ?? { type: 'op', op: 'and', children: [] };
    }
    updateSmartCollection.mutate({
      path: { id },
      body: { name: values.name, keywords: values.keywords, filter },
    });
  };

  if (isLoading) return <LinearProgress />;
  if (isError)
    return (
      <Alert severity="error">
        <Trans>Failed to load Smart Collection</Trans>
      </Alert>
    );
  if (!smartCollection) return null;

  return (
    <FormProvider {...form}>
      <Box
        component="form"
        onSubmit={form.handleSubmit(handleSave)}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <DialogTitle>
          <Trans>Editing Smart Collection "{smartCollection.name}"</Trans>
        </DialogTitle>
        <DialogContent>
          <Box
            component="fieldset"
            disabled={saving}
            ref={(element: HTMLFieldSetElement | null) => {
              if (element) element.inert = saving;
            }}
            sx={{ border: 0, m: 0, p: 0, pt: 1, minWidth: 0 }}
          >
            <Stack gap={2}>
              <Controller
                control={control}
                name="name"
                rules={{
                  validate: (value) =>
                    value.trim().length > 0 || t`Enter a name`,
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    fullWidth
                    label={t`Name`}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    {...field}
                  />
                )}
              />
              <Controller
                control={control}
                name="keywords"
                render={({ field }) => (
                  <TextField fullWidth label={t`Keywords`} {...field} />
                )}
              />
              <SearchFilterBuilder stackControlsOnMobile />
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={onClose}>
            {actions.cancel}
          </Button>
          <Button
            type="submit"
            disabled={!isValid || !isDirty || saving}
            loading={saving}
            startIcon={<Save />}
            variant="contained"
          >
            {actions.save}
          </Button>
        </DialogActions>
      </Box>
    </FormProvider>
  );
};
