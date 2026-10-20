import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { removeFillerListProgram } from '@/store/entityEditor/util.ts';
import {
  clearCurrentFillerList,
  discardFillerListChanges,
  resetFillerListEditor,
  setCurrentFillerList,
  updateCurrentFillerList,
} from '@/store/fillerListEditor/action.ts';
import { useToasts } from '@/strings/actions';
import { Trans, useLingui } from '@lingui/react/macro';
import { Delete, Tv } from '@mui/icons-material';
import { Button, Divider, Stack, TextField, Tooltip } from '@mui/material';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from '@tanstack/react-router';
import type { FillerList } from '@tunarr/types';
import { isEmpty, isEqual } from 'lodash-es';
import { useCallback, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  postApiFillerLists,
  putApiFillerListsById,
} from '../../generated/sdk.gen.ts';
import { invalidateTaggedQueries } from '../../helpers/queryUtil.ts';
import useStore from '../../store/index.ts';
import type { UIFillerListProgram } from '../../types/index.ts';
import ChannelLineupList from '../channel_config/ChannelLineupList.tsx';

type FillerListFormValues = {
  name: string;
};

type FillerListSave = FillerListFormValues & {
  programs: UIFillerListProgram[];
};

type EditFillerListFormProps = {
  /** The list as it is saved, or the starting values of a new one. */
  fillerList: FillerList;
  isNew: boolean;
};

/**
 * The filler list editor: the list's name, and its programs, which live in
 * the store's filler list draft so the add-programs page can add to them.
 * Changes to that draft count as unsaved changes of the form.
 */
export function EditFillerListForm({
  fillerList,
  isNew,
}: EditFillerListFormProps) {
  const { t } = useLingui();
  const toasts = useToasts();
  const navigate = useNavigate();
  const programList = useStore((s) => s.fillerListEditor.programList);
  const programsDirty = useStore((s) => s.fillerListEditor.dirty.programs);

  const form = useForm<FillerListFormValues>({
    mode: 'onTouched',
    defaultValues: {
      name: fillerList.name,
    },
  });
  const {
    control,
    getValues,
    setValue,
    reset,
    formState: { defaultValues },
  } = form;

  useEffect(() => {
    const loaded = { name: fillerList.name };
    if (!isEqual(loaded, defaultValues)) {
      reset(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillerList.name, reset]);

  // A name typed before going to add programs was kept in the draft. Bring it
  // back as an unsaved change
  useEffect(() => {
    const draftName = useStore.getState().fillerListEditor.currentEntity?.name;
    if (draftName !== undefined && draftName !== fillerList.name) {
      setValue('name', draftName, { shouldDirty: true });
    }
    // Only when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMutation = useSettingsMutation({
    form,
    mutation: {
      mutationKey: ['fillers', isNew ? 'new' : fillerList.id],
      mutationFn: async ({ name, programs }: FillerListSave) => {
        if (isNew) {
          const { data } = await postApiFillerLists({
            body: { name, programs },
            throwOnError: true,
          });
          return data;
        }
        const { data } = await putApiFillerListsById({
          path: { id: fillerList.id },
          body: { name, programs },
          throwOnError: true,
        });
        return data;
      },
      onSuccess: async (data, { name, programs }) => {
        if (isNew) {
          // The draft counts as unsaved until it is emptied, which happens
          // after the page has gone
          await navigate({ to: '/library/fillers', ignoreBlocker: true });
          resetFillerListEditor();
        } else {
          setCurrentFillerList({ ...fillerList, ...data, name }, programs);
        }
      },
    },
    toFormValues: (_saved, { name }) => ({ name }),
    invalidate: { predicate: invalidateTaggedQueries('Filler Lists') },
    failureMessage: toasts.couldNotSave,
  });

  const deleteProgramAtIndex = useCallback((idx: number) => {
    removeFillerListProgram(idx);
  }, []);

  const navToProgramming = () => {
    // The form is rebuilt when this page opens again; keep the name in the
    // draft until then
    updateCurrentFillerList({ name: getValues('name') });
    navigate({
      to: isNew
        ? '/library/fillers/new/programming'
        : `/library/fillers/$fillerId/programming`,
      params: { fillerId: fillerList.id },
    }).catch(console.warn);
  };

  return (
    <SettingsForm
      form={form}
      onSubmit={({ name }) =>
        saveMutation.mutate({ name, programs: programList })
      }
      isNew={isNew}
      isSubmitting={saveMutation.isPending}
      hasOtherChanges={programsDirty}
      onDiscardChanges={discardFillerListChanges}
      // A filler list needs at least one program
      saveDisabled={programList.length === 0}
      // The programs are saved from the draft as they were when Save was
      // pressed, so they must not change until the save is done
      disabled={saveMutation.isPending}
      // Adding programs edits the same draft on its own page
      exceptTargetPaths={[
        '/library/fillers/new/programming',
        '/library/fillers/$fillerId/programming',
      ]}
    >
      <Stack gap={2}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <TextField margin="normal" fullWidth label={t`Name`} {...field} />
          )}
        />
        <Divider />

        <Box>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', mb: 2, flexWrap: 'wrap' }}
            gap={2}
          >
            <Typography
              variant="h6"
              component="h2"
              sx={{ flex: 1, flexBasis: ['100%', 'auto'] }}
            >
              <Trans>Programming</Trans>
            </Typography>
            <Button
              disableRipple
              component="button"
              onClick={() => clearCurrentFillerList()}
              startIcon={<Delete />}
              variant="outlined"
              disabled={isEmpty(programList)}
            >
              <Trans>Clear All</Trans>
            </Button>
            <Tooltip
              title={t`Add TV Shows or Movies to filler`}
              placement="right"
            >
              <Button
                disableRipple
                component="button"
                onClick={() => navToProgramming()}
                startIcon={<Tv />}
                variant="outlined"
              >
                <Trans>Add Media</Trans>
              </Button>
            </Tooltip>
          </Stack>
          <ChannelLineupList
            type="selector"
            programListSelector={(s) => s.fillerListEditor.programList}
            enableDnd={false}
            enableRowEdit={false}
            showProgramCount
            deleteProgram={deleteProgramAtIndex}
            virtualListProps={{
              width: '100%',
              height: 600,
              itemSize: 35,
            }}
          />
        </Box>
      </Stack>
    </SettingsForm>
  );
}
