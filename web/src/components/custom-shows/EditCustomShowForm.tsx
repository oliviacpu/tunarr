import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import { isNonEmptyString } from '@/helpers/util.ts';
import { customShowQuery } from '@/hooks/useCustomShows.ts';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import useStore from '@/store';
import {
  clearCurrentCustomShow,
  discardCustomShowChanges,
  markCustomShowSaved,
  moveProgramInCustomShow,
  updateCurrentCustomShow,
} from '@/store/customShowEditor/actions.ts';
import { removeCustomShowProgram } from '@/store/entityEditor/util';
import { useToasts } from '@/strings/actions';
import type { UICondensedContentProgram } from '@/types';
import { Trans, useLingui } from '@lingui/react/macro';
import { Refresh, Sync, Tv } from '@mui/icons-material';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type CustomShow, type Playlist } from '@tunarr/types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { isEqual } from 'lodash-es';
import { useCallback, useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  getApiCustomShowsByIdProgramsQueryKey,
  getApiCustomShowsByIdQueryKey,
} from '../../generated/@tanstack/react-query.gen.ts';
import {
  createCustomShow,
  getApiMediaSources,
  getApiPlexByMediaSourceIdPlaylists,
  putApiCustomShowsById,
  syncCustomShow,
} from '../../generated/sdk.gen.ts';
import ChannelLineupList from '../channel_config/ChannelLineupList.tsx';
import { CustomShowSortToolsMenu } from './CustomShowSortToolsMenu.tsx';

dayjs.extend(relativeTime);

type CustomShowForm = {
  name: string;
  syncEnabled: boolean;
  syncMediaSourceId: string;
  syncExternalPlaylistId: string;
};

type CustomShowSave = CustomShowForm & {
  programs: UICondensedContentProgram[];
};

/** The form's values for a show as it is saved. */
function toCustomShowFormValues(
  show: Pick<
    CustomShow,
    'name' | 'syncMediaSourceId' | 'syncExternalPlaylistId'
  >,
): CustomShowForm {
  return {
    name: show.name,
    syncEnabled: isNonEmptyString(show.syncMediaSourceId),
    syncMediaSourceId: show.syncMediaSourceId ?? '',
    syncExternalPlaylistId: show.syncExternalPlaylistId ?? '',
  };
}

type Props = {
  /** The show as it is saved, or the starting values of a new one. */
  customShow: CustomShow;
  customShowPrograms: UICondensedContentProgram[];
  isNew: boolean;
};

/**
 * The custom show editor: the show's name and playlist sync, and its
 * programs, which live in the store's custom show draft so the add-programs
 * page can add to them. Changes to that draft count as unsaved changes of the
 * form.
 */
export function EditCustomShowsForm({
  customShow,
  customShowPrograms,
  isNew,
}: Props) {
  const { t } = useLingui();
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const customShowProgrammingChanged = useStore(
    (s) => s.customShowEditor.dirty.programs,
  );
  useQuery({
    ...customShowQuery(customShow.id),
    enabled: !isNew,
    refetchInterval: customShow.isSyncing ? 5_000 : undefined,
  });

  const isSynced = !!customShow.syncMediaSourceId;

  const form = useForm<CustomShowForm>({
    mode: 'onTouched',
    defaultValues: toCustomShowFormValues(customShow),
  });
  const {
    control,
    reset,
    getValues,
    setValue,
    formState: { defaultValues },
  } = form;

  const [syncEnabled, selectedMediaSourceId] = useWatch({
    control,
    name: ['syncEnabled', 'syncMediaSourceId'],
  });

  // Load the saved show into the form. A reload that brings back what the
  // form already compares against is skipped, such as the refetch after a
  // save or every few seconds while the show syncs: resetting would drop the
  // user's changes
  useEffect(() => {
    const loaded = toCustomShowFormValues(customShow);
    if (!isEqual(loaded, defaultValues)) {
      reset(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customShow, reset]);

  // A name typed before going to add programs was kept in the draft. Bring it
  // back as an unsaved change
  useEffect(() => {
    const draftName = useStore.getState().customShowEditor.currentEntity?.name;
    if (draftName !== undefined && draftName !== customShow.name) {
      setValue('name', draftName, { shouldDirty: true });
    }
    // Only when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch media sources for the dropdown
  const { data: mediaSources } = useQuery({
    queryKey: ['settings', 'media-sources'],
    queryFn: async () => {
      const result = await getApiMediaSources({ throwOnError: true });
      return result.data;
    },
  });

  // Filter to only Plex sources for now
  const plexSources = (mediaSources ?? []).filter((s) => s.type === 'plex');

  // Fetch playlists for selected media source
  const { data: playlists, isLoading: playlistsLoading } = useQuery({
    queryKey: ['plex', selectedMediaSourceId, 'playlists'],
    queryFn: async () => {
      const result = await getApiPlexByMediaSourceIdPlaylists({
        path: { mediaSourceId: selectedMediaSourceId },
        throwOnError: true,
      });
      return result.data;
    },
    enabled: syncEnabled && !!selectedMediaSourceId,
  });

  const playlistItems: Playlist[] = playlists?.result ?? [];

  const saveShowMutation = useSettingsMutation({
    form,
    mutation: {
      mutationKey: ['custom-shows', isNew ? 'new' : customShow.id],
      mutationFn: async (values: CustomShowSave) => {
        const body = {
          name: values.name,
          // Sync owns a synced show's programs, so leave them out. An explicit
          // list replaces the show's contents.
          ...(values.syncEnabled ? {} : { programs: values.programs }),
          enableSync: values.syncEnabled,
          ...(values.syncEnabled &&
          isNonEmptyString(values.syncMediaSourceId) &&
          isNonEmptyString(values.syncExternalPlaylistId)
            ? {
                syncMediaSourceId: values.syncMediaSourceId,
                syncMediaSourceType: 'plex' as const,
                syncExternalPlaylistId: values.syncExternalPlaylistId,
              }
            : {
                syncMediaSourceId: null,
                syncMediaSourceType: null,
                syncExternalPlaylistId: null,
              }),
        };

        if (isNew) {
          const created = await createCustomShow({ body, throwOnError: true });
          return created.data;
        }
        const updated = await putApiCustomShowsById({
          path: { id: customShow.id },
          body,
          throwOnError: true,
        });
        return updated.data;
      },
      onSuccess: async (saved) => {
        if (isNew) {
          // The draft counts as unsaved until it is emptied, which happens
          // after the page has gone
          await navigate({ to: '/library/custom-shows', ignoreBlocker: true });
          clearCurrentCustomShow();
        } else {
          markCustomShowSaved(saved);
        }
      },
    },
    toFormValues: (saved) => toCustomShowFormValues(saved),
    // The show list, the show and its programs
    invalidate: { predicate: invalidateTaggedQueries('Custom Shows') },
    failureMessage: toasts.couldNotSave,
  });

  const syncNowMutation = useMutation({
    mutationKey: ['custom-shows', customShow.id, 'sync'],
    mutationFn: async () => {
      return syncCustomShow({
        path: { id: customShow.id },
        throwOnError: true,
      });
    },
    onSuccess: async (updatedShow) => {
      updateCurrentCustomShow(updatedShow.data);
      await queryClient.invalidateQueries({
        queryKey: getApiCustomShowsByIdProgramsQueryKey({
          path: { id: customShow.id },
        }),
      });
      await queryClient.invalidateQueries({
        queryKey: getApiCustomShowsByIdQueryKey({
          path: { id: customShow.id },
        }),
      });
    },
  });

  const navToProgramming = () => {
    // The form is rebuilt when this page opens again; keep the name in the
    // draft until then
    updateCurrentCustomShow({ name: getValues('name') });
    navigate({
      to: isNew
        ? '/library/custom-shows/new/programming'
        : `/library/custom-shows/$showId/programming`,
      params: { showId: customShow?.id },
    }).catch(console.warn);
  };

  const handleSyncToggle = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setValue('syncMediaSourceId', '');
        setValue('syncExternalPlaylistId', '');
      }
    },
    [setValue],
  );

  return (
    <SettingsForm
      form={form}
      onSubmit={(data) =>
        saveShowMutation.mutate({ ...data, programs: customShowPrograms })
      }
      isNew={isNew}
      isSubmitting={saveShowMutation.isPending}
      hasOtherChanges={customShowProgrammingChanged}
      onDiscardChanges={discardCustomShowChanges}
      // A show that isn't synced needs at least one program
      saveDisabled={!syncEnabled && customShowPrograms.length === 0}
      // The programs are saved from the draft as they were when Save was
      // pressed, so they must not change until the save is done
      disabled={saveShowMutation.isPending}
      // Adding programs edits the same draft on its own page
      exceptTargetPaths={[
        '/library/custom-shows/new/programming',
        '/library/custom-shows/$showId/programming',
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
          <Controller
            control={control}
            name="syncEnabled"
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Switch
                    checked={field.value}
                    onChange={(e) => {
                      field.onChange(e.target.checked);
                      handleSyncToggle(e.target.checked);
                    }}
                  />
                }
                label={t`Sync with external playlist`}
              />
            )}
          />
        </Box>

        {syncEnabled && (
          <Stack gap={2}>
            <Controller
              control={control}
              name="syncMediaSourceId"
              rules={{
                required: syncEnabled,
                minLength: syncEnabled ? 1 : 0,
              }}
              render={({ field }) => (
                <Autocomplete
                  options={plexSources}
                  getOptionLabel={(opt) => opt.name}
                  value={plexSources.find((s) => s.id === field.value) ?? null}
                  onChange={(_, newVal) => {
                    field.onChange(newVal?.id ?? undefined);
                    setValue('syncExternalPlaylistId', '');
                  }}
                  renderInput={(params) => (
                    <TextField {...params} label={t`Media Source`} />
                  )}
                />
              )}
            />

            {selectedMediaSourceId && (
              <Controller
                control={control}
                name="syncExternalPlaylistId"
                rules={{
                  required: syncEnabled,
                  minLength: syncEnabled ? 1 : 0,
                }}
                render={({ field }) => (
                  <Autocomplete
                    options={playlistItems}
                    getOptionLabel={(opt) => opt.title}
                    value={
                      playlistItems.find((p) => p.externalId === field.value) ??
                      null
                    }
                    onChange={(_, newVal) =>
                      field.onChange(newVal?.externalId ?? undefined)
                    }
                    loading={playlistsLoading}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={t`Playlist`}
                        slotProps={{
                          input: {
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {playlistsLoading && (
                                  <CircularProgress size={20} />
                                )}
                                {params.InputProps.endAdornment}
                              </>
                            ),
                          },
                        }}
                      />
                    )}
                  />
                )}
              />
            )}

            {!isNew && isSynced && (
              <Stack direction="row" gap={2} sx={{ alignItems: 'center' }}>
                <Button
                  variant="outlined"
                  startIcon={
                    syncNowMutation.isPending ? (
                      <CircularProgress size={16} />
                    ) : (
                      <Refresh />
                    )
                  }
                  onClick={() => syncNowMutation.mutate()}
                  disabled={syncNowMutation.isPending || customShow.isSyncing}
                >
                  <Trans>Sync Now</Trans>
                </Button>
                {customShow.lastSyncedAt && (
                  <Typography variant="body2" color="text.secondary">
                    <Trans>
                      Last synced {dayjs(customShow.lastSyncedAt).fromNow()}
                    </Trans>
                  </Typography>
                )}
              </Stack>
            )}
          </Stack>
        )}

        <Divider />

        <Box>
          {isSynced && !isNew && (
            <Alert severity="info" sx={{ mb: 2 }} icon={<Sync />}>
              <Trans>
                This custom show is synced with an external playlist. Content is
                updated automatically and cannot be edited manually.
              </Trans>
            </Alert>
          )}

          <Box>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', mb: 2, flexWrap: 'wrap' }}
              gap={2}
            >
              <Typography
                variant="h6"
                sx={{ flex: 1, flexBasis: ['100%', 'auto'] }}
              >
                <Trans>Programming</Trans>
              </Typography>

              {!syncEnabled && (
                <>
                  <CustomShowSortToolsMenu />
                  <Tooltip
                    title={t`Add programming to custom show`}
                    placement="top"
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
                </>
              )}
            </Stack>
          </Box>
          <Paper>
            <ChannelLineupList
              type="selector"
              programListSelector={(s) => s.customShowEditor.programList}
              moveProgram={moveProgramInCustomShow}
              deleteProgram={removeCustomShowProgram}
              enableDnd={!syncEnabled}
              enableRowDelete={!syncEnabled}
              enableRowEdit={!syncEnabled}
              virtualListProps={{
                width: '100%',
                height: 600,
                itemSize: 35,
              }}
            />
          </Paper>
        </Box>
      </Stack>
    </SettingsForm>
  );
}
