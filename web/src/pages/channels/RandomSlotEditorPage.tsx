import { useToasts } from '@/strings/actions';
import { PageHeader } from '@/components/base/PageHeader.tsx';
import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { RandomSlotFormProvider } from '@/components/slot_scheduler/RandomSlotFormProvider.tsx';
import { RandomSlotSettingsForm } from '@/components/slot_scheduler/RandomSlotSettingsForm';
import { RandomSlotTable } from '@/components/slot_scheduler/RandomSlotTable.tsx';
import { useSlotProgramOptions } from '@/hooks/programming_controls/useSlotProgramOptions';
import { defaultRandomSlotSchedule } from '@/model/SlotModels.ts';
import { useChannelEditor } from '@/store/selectors';
import useStore from '@/store/index.ts';
import { plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { ArrowBack, HelpOutline } from '@mui/icons-material';
import {
  Alert,
  Box,
  Divider,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { seq } from '@tunarr/shared/util';
import type { RandomSlotSchedule } from '@tunarr/types/api';
import { useToggle } from '@uidotdev/usehooks';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import {
  filter,
  groupBy,
  isUndefined,
  keys,
  mapValues,
  orderBy,
  round,
  sum,
} from 'lodash-es';
import React, { useCallback, useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import Breadcrumbs from '../../components/Breadcrumbs';
import PaddedPaper from '../../components/base/PaddedPaper';
import { RouterButtonLink } from '../../components/base/RouterButtonLink.tsx';
import ChannelLineupList from '../../components/channel_config/ChannelLineupList.tsx';
import { SlotProgrammingOptionsProvider } from '../../components/slot_scheduler/SlotProgrammingOptionsProvider.tsx';
import { postApiChannelsByIdProgramming } from '../../generated/sdk.gen.ts';
import { getProgramGroupingKey } from '../../helpers/programUtil.ts';
import { invalidateTaggedQueries } from '../../helpers/queryUtil.ts';
import {
  lineupItemAppearsInSchedule,
  unavailableCustomShowSlotIndexes,
} from '../../helpers/slotSchedulerUtil';
import { useChannelSchedule } from '../../hooks/useChannelSchedule.ts';
import { useSettingsMutation } from '../../hooks/useSettingsMutation.ts';
import type { RandomSlotForm } from '../../model/SlotModels.ts';
import {
  resetCurrentLineup,
  resetLineup,
} from '../../store/channelEditor/actions';
import type { Maybe } from '../../types/util.ts';

dayjs.extend(duration);

export default function RandomSlotEditorPage() {
  const { currentEntity: channel, programList: newLineup } = useChannelEditor();
  const { data: channelSchedule } = useChannelSchedule(channel!.id);

  const toasts = useToasts();

  const theme = useTheme();
  const smallViewport = useMediaQuery(theme.breakpoints.down('sm'));
  const { nameById: programOptionNameById, dropdownOpts: programOptions } =
    useSlotProgramOptions();
  const [isCalculatingSlots, toggleIsCalculatingSlots] = useToggle(false);
  const [randomState, setRandomState] =
    useState<Maybe<{ seed?: number[]; discardCount?: number }>>();

  const hasExistingTimeSlotSchedule = channelSchedule.schedule?.type === 'time';

  const randomSlotForm = useForm<RandomSlotForm>({
    mode: 'onTouched',
    defaultValues:
      channelSchedule.schedule?.type === 'random'
        ? {
            ...channelSchedule.schedule,
            slots: orderBy(
              channelSchedule.schedule.slots,
              (slot, idx) => slot.index ?? idx,
              'asc',
            ),
            lockWeights:
              channelSchedule.schedule.randomDistribution !== 'weighted'
                ? false
                : sum(
                    channelSchedule.schedule.slots.map((slot) => slot.weight),
                  ) > 100,
          }
        : defaultRandomSlotSchedule,
  });

  const { control } = randomSlotForm;

  const slotArray = useFieldArray({
    control,
    name: 'slots',
    rules: {
      required: true,
    },
  });
  const slots = useWatch({ control, name: 'slots' });
  const unavailableSlotCount = unavailableCustomShowSlotIndexes(
    slots,
    programOptions,
  ).length;

  // A refreshed preview is a new lineup to save, even with no slot changed
  const previewChanged = useStore((s) => s.channelEditor.dirty.programs);

  const saveMutation = useSettingsMutation({
    form: randomSlotForm,
    mutation: {
      mutationFn: async (values: RandomSlotForm) => {
        if (channel === undefined) {
          throw new Error('No channel is open to save the schedule to');
        }
        const schedule: RandomSlotSchedule = {
          ...values,
          // Index is controlled by the field array functions
          slots: values.slots.map((slot, idx) => ({ ...slot, index: idx })),
          timeZoneOffset: new Date().getTimezoneOffset(),
          type: 'random',
        };

        // Find programs that have active slots
        const filteredLineup = filter(newLineup, (item) =>
          lineupItemAppearsInSchedule(values.slots, item),
        );

        const { data } = await postApiChannelsByIdProgramming({
          path: { id: channel.id },
          body: {
            type: 'random',
            schedule,
            programs: seq.collect(filteredLineup, (l) => {
              switch (l.type) {
                case 'custom':
                case 'content':
                  return l.id;
                case 'redirect':
                case 'flex':
                case 'filler':
                  return null;
              }
            }),
            seed: randomState?.seed,
            discardCount: randomState?.discardCount,
          },
          throwOnError: true,
        });
        return data;
      },
      // The saved lineup replaces the preview
      onSuccess: (lineup) => resetCurrentLineup(lineup),
    },
    toFormValues: (_lineup, values) => values,
    invalidate: { predicate: invalidateTaggedQueries('Channels') },
    failureMessage: toasts.couldNotSave,
  });

  const programFrequency = useMemo(() => {
    const total = newLineup.length;
    const sums = mapValues(
      groupBy(newLineup, getProgramGroupingKey),
      (group) => group.length,
    );

    return seq.collect(keys(sums), (key) => {
      const name = programOptionNameById[key];
      if (!name) {
        return;
      }

      return (
        <React.Fragment key={key}>
          <span key={key}>
            {name}: {round((sums[key] / total) * 100, 2)}%
          </span>
          <br />
        </React.Fragment>
      );
    });
  }, [newLineup, programOptionNameById]);

  const onCalculateSlotsEnd = useCallback(
    (state?: { seed?: number[]; discardCount?: number }) => {
      setRandomState(state);
      toggleIsCalculatingSlots(false);
    },
    [toggleIsCalculatingSlots],
  );

  if (isUndefined(channel)) {
    return (
      <div>
        <Trans>Loading</Trans>
      </div>
    );
  }

  return (
    <SettingsForm
      form={randomSlotForm}
      onSubmit={(values) => saveMutation.mutate(values)}
      isSubmitting={saveMutation.isPending}
      hasOtherChanges={previewChanged}
      // Leaving or resetting puts the saved lineup back in place of the
      // preview
      onDiscardChanges={resetLineup}
      // The alert above the slots says why
      saveDisabled={unavailableSlotCount > 0}
      // The preview saved is the one shown when Save was pressed
      disabled={saveMutation.isPending}
    >
      <PageHeader
        breadcrumbs={<Breadcrumbs />}
        title={<Trans>Slot Scheduler</Trans>}
        actions={
          <RouterButtonLink
            variant="outlined"
            to=".."
            startIcon={<ArrowBack />}
          >
            <Trans>Back to Programming</Trans>
          </RouterButtonLink>
        }
      />
      <Stack gap={2} useFlexGap>
        {hasExistingTimeSlotSchedule && (
          <Alert severity="warning">
            <Trans>
              This channel has an existing time slot schedule. A channel can
              only use one scheduling type at a time. Saving a schedule here
              will remove the existing time slot schedule.
            </Trans>
          </Alert>
        )}
        {unavailableSlotCount > 0 && (
          <Alert severity="error">
            {plural(unavailableSlotCount, {
              one: '# slot uses a custom show that is empty or deleted. Fix or remove it before saving.',
              other:
                '# slots use a custom show that is empty or deleted. Fix or remove them before saving.',
            })}
          </Alert>
        )}
        <PaddedPaper>
          <Typography sx={{ flexGrow: 1, fontWeight: 600 }}>
            <Trans>Slots</Trans>
          </Typography>
          <Divider sx={{ my: 2 }} />
          <SlotProgrammingOptionsProvider>
            <RandomSlotFormProvider {...randomSlotForm} slotArray={slotArray}>
              <RandomSlotTable />
            </RandomSlotFormProvider>
            <Divider sx={{ my: 2 }} />
            <RandomSlotSettingsForm
              onCalculateStart={() => toggleIsCalculatingSlots(true)}
              onCalculateEnd={onCalculateSlotsEnd}
            />
          </SlotProgrammingOptionsProvider>
        </PaddedPaper>
        <PaddedPaper>
          <Stack direction="row" sx={{ width: '100%' }}>
            <Typography sx={{ pb: 1 }}>
              <Trans>Programming Preview</Trans>
            </Typography>
            <Typography sx={{ ml: 'auto' }}>
              <Tooltip title={<>{programFrequency}</>} placement="left">
                <HelpOutline />
              </Tooltip>
            </Typography>
          </Stack>
          <Divider />
          <Box sx={{ minHeight: 400 }}>
            <ChannelLineupList
              type="selector"
              enableDnd={false}
              enableRowDelete={false}
              enableRowEdit={false}
              listEmptyMessage={
                isCalculatingSlots ? <Trans>Calculating Slots...</Trans> : null
              }
              virtualListProps={{
                width: '100%',
                height: 400,
                itemSize: smallViewport ? 70 : 35,
                overscanCount: 5,
              }}
            />
          </Box>
        </PaddedPaper>
      </Stack>
    </SettingsForm>
  );
}
