import { useToasts } from '@/strings/actions';
import { LoadingIcon } from '@/components/base/LoadingIcon.tsx';
import { PageHeader } from '@/components/base/PageHeader.tsx';
import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import ChannelLineupList from '@/components/channel_config/ChannelLineupList.tsx';
import { TimeSlotFormProvider } from '@/components/slot_scheduler/TimeSlotFormProvider.tsx';
import { TimeSlotTable } from '@/components/slot_scheduler/TimeSlotTable.tsx';
import {
  OneDayMillis,
  OneWeekMillis,
  dropdownValueToOverflow,
  flexOptions,
  latenessOptions,
  lineupItemAppearsInSchedule,
  overflowOptions,
  overflowToDropdownValue,
  padOptions,
  unavailableCustomShowSlotIndexes,
} from '@/helpers/slotSchedulerUtil.ts';
import { v4 } from 'uuid';
import type {
  TimeSlotForm,
  TimeSlotViewModel,
} from '@/model/TimeSlotModels.ts';
import { useChannelEditorLazy } from '@/store/selectors.ts';
import useStore from '@/store/index.ts';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowBack, Autorenew, ExpandMore } from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Divider,
  FormControl,
  FormGroup,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers';
import { dayjsMod } from '@tunarr/shared';
import { seq } from '@tunarr/shared/util';
import type {
  MaterializedTimeSlotSchedule,
  TimeSlotSchedule,
} from '@tunarr/types/api';
import { useToggle } from '@uidotdev/usehooks';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  filter,
  flatMap,
  groupBy,
  head,
  map,
  mapValues,
  range,
  sortBy,
  values,
} from 'lodash-es';
import { useCallback, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import PaddedPaper from '../../components/base/PaddedPaper.tsx';
import { RouterButtonLink } from '../../components/base/RouterButtonLink.tsx';
import { SlotProgrammingOptionsProvider } from '../../components/slot_scheduler/SlotProgrammingOptionsProvider.tsx';
import { useSlotProgramOptions } from '../../hooks/programming_controls/useSlotProgramOptions.ts';
import { NumericFormControllerText } from '../../components/util/TypedController.tsx';
import { postApiChannelsByIdProgramming } from '../../generated/sdk.gen.ts';
import { invalidateTaggedQueries } from '../../helpers/queryUtil.ts';
import { toggle } from '../../helpers/util.ts';
import { useScheduleSlots } from '../../hooks/slot_scheduler/useScheduleSlots.ts';
import { useChannelSchedule } from '../../hooks/useChannelSchedule.ts';
import { useSettingsMutation } from '../../hooks/useSettingsMutation.ts';
import {
  resetCurrentLineup,
  resetLineup,
} from '../../store/channelEditor/actions.ts';
import type { Maybe } from '../../types/util.ts';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(dayjsMod);

const defaultTimeSlotSchedule: TimeSlotSchedule = {
  type: 'time',
  flexPreference: 'distribute',
  latenessMs: 0,
  maxDays: 365,
  overflow: { type: 'duration', maxMs: 0 },
  padMs: 1,
  slots: [],
  period: 'day',
  timeZoneOffset: new Date().getTimezoneOffset(),
};

function convertToViewModel(
  schedule: MaterializedTimeSlotSchedule,
): TimeSlotForm {
  return {
    ...schedule,
    slots: map(schedule.slots, (slot) => ({
      ...slot,
      startTime:
        slot.startTime %
        (schedule.period === 'week' ? OneWeekMillis : OneDayMillis),
    })),
  };
}

export default function TimeSlotEditorPage() {
  const { t } = useLingui();
  const toasts = useToasts();
  const {
    channelEditor: { currentEntity: channel },
    materializeOriginalProgramList,
  } = useChannelEditorLazy();
  const { data: channelSchedule } = useChannelSchedule(channel!.id);

  const [startTime, setStartTime] = useState(
    channel?.startTime ? dayjs(channel?.startTime) : dayjs(),
  );
  const [randomState, setRandomState] =
    useState<Maybe<{ seed?: number[]; discardCount?: number }>>();

  const [settingsOpen, setSettingsOpen] = useState(true);

  const theme = useTheme();
  const smallViewport = useMediaQuery(theme.breakpoints.down('sm'));

  const [isCalculatingSlots, toggleIsCalculatingSlots] = useToggle(false);

  const formMethods = useForm<TimeSlotForm>({
    mode: 'onTouched',
    defaultValues:
      channelSchedule.schedule?.type === 'time'
        ? convertToViewModel(channelSchedule.schedule)
        : defaultTimeSlotSchedule,
  });

  const {
    control,
    getValues,
    setValue,
    formState: { errors },
  } = formMethods;

  const slotArray = useFieldArray({
    control,
    name: 'slots',
    rules: {
      required: true,
    },
  });
  const { dropdownOpts: programOptions } = useSlotProgramOptions();
  const slots = useWatch({ control, name: 'slots' });
  const unavailableSlotCount = unavailableCustomShowSlotIndexes(
    slots,
    programOptions,
  ).length;

  // A refreshed preview is a new lineup to save, even with no slot changed
  const previewChanged = useStore((s) => s.channelEditor.dirty.programs);

  const saveMutation = useSettingsMutation({
    form: formMethods,
    mutation: {
      mutationFn: async (values: TimeSlotForm) => {
        if (channel === undefined) {
          throw new Error('No channel is open to save the schedule to');
        }
        const schedule = {
          ...values,
          timeZoneOffset: new Date().getTimezoneOffset(),
          type: 'time',
        } satisfies TimeSlotSchedule;

        // Find programs that have active slots
        const filteredLineup = filter(
          materializeOriginalProgramList(),
          (item) => lineupItemAppearsInSchedule(values.slots, item),
        );

        const { data } = await postApiChannelsByIdProgramming({
          path: { id: channel.id },
          body: {
            type: 'time',
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

  const handlePeriodChange = useCallback(
    (e: SelectChangeEvent<'day' | 'week' | 'month'>) => {
      const value = e.target.value as TimeSlotSchedule['period'];
      setValue('period', value, { shouldDirty: true });
      let newSlots: TimeSlotViewModel[] = [];
      const currentSlots = getValues('slots');
      if (value === 'day') {
        // Remove slots
        // This is (sort of) what the original behavior was... keep
        // as many unique time starts as possible. Seems weird. We
        // can change in the future if we want.
        const reducedSlots = values(
          mapValues(
            groupBy(
              currentSlots.map((slot) => ({
                ...slot,
                startTime: dayjs(slot.startTime)
                  .mod(dayjs.duration(1, 'day'))
                  .asMilliseconds(),
              })),
              (slot) => slot.startTime,
            ),
            (v) => head(v)!,
          ),
        );
        newSlots = sortBy(reducedSlots, 'startTime');
      } else if (value === 'week') {
        const offsets = map(range(0, 7), (i) => i * OneDayMillis);

        // For each day offset, spread out the current slots for each day
        newSlots = flatMap(offsets, (offset) => {
          return map(currentSlots, (slot) => ({
            ...slot,
            ...('id' in slot ? { id: v4() } : {}),
            startTime: slot.startTime + offset,
          }));
        });
      }

      // Add slots
      slotArray.replace(newSlots);
    },
    [setValue, getValues, slotArray],
  );

  const { scheduleTimeSlots } = useScheduleSlots();

  const calculateSlots = () => {
    toggleIsCalculatingSlots(true);
    scheduleTimeSlots(getValues())
      .then(({ startTime, seed, discardCount }) => {
        setStartTime(dayjs(startTime));
        setRandomState({ seed, discardCount });
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        toggleIsCalculatingSlots(false);
      });
  };

  return (
    <SettingsForm
      form={formMethods}
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
        title={channel?.name}
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
        {errors.slots?.message && (
          <Alert severity="error">{errors.slots.message}</Alert>
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
          <Stack direction="row" alignItems="center">
            <Typography sx={{ flexGrow: 1, fontWeight: 600 }}>
              <Trans>Time Slots</Trans>
            </Typography>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <TimeSlotFormProvider {...formMethods} slotArray={slotArray}>
            <SlotProgrammingOptionsProvider>
              <TimeSlotTable />
            </SlotProgrammingOptionsProvider>
          </TimeSlotFormProvider>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row">
            <Typography sx={{ flexGrow: 1, fontWeight: '600' }}>
              <Trans>Settings</Trans>
            </Typography>
            <ExpandMore
              sx={{ cursor: 'pointer' }}
              onClick={() => setSettingsOpen(toggle)}
            />
          </Stack>
          <Collapse in={settingsOpen}>
            <Box>
              <Grid
                container
                spacing={2}
                columns={16}
                justifyContent={'flex-start'}
              >
                <Grid size={{ sm: 16, md: 5 }}>
                  <FormControl fullWidth margin="normal">
                    <InputLabel>
                      <Trans>Period</Trans>
                    </InputLabel>
                    <Controller
                      control={control}
                      name="period"
                      render={({ field }) => (
                        <Select
                          label={t`Period`}
                          {...field}
                          onChange={(e) => handlePeriodChange(e)}
                        >
                          <MenuItem value="day">
                            <Trans>Daily</Trans>
                          </MenuItem>
                          <MenuItem value="week">
                            <Trans>Weekly</Trans>
                          </MenuItem>
                        </Select>
                      )}
                    />
                    <FormHelperText>
                      <Trans>
                        By default, time slots are time of the day-based, you
                        can change it to time of the day + day of the week. That
                        means scheduling 7x the number of time slots. If you
                        change from daily to weekly, the current schedule will
                        be repeated 7 times. If you change from weekly to daily,
                        many of the slots will be deleted.
                      </Trans>
                    </FormHelperText>
                  </FormControl>
                </Grid>
                <Grid size={{ sm: 16, md: 5 }}>
                  <FormControl fullWidth margin="normal">
                    <InputLabel>
                      <Trans>Max Lateness</Trans>
                    </InputLabel>
                    <Controller
                      control={control}
                      name="latenessMs"
                      render={({ field }) => (
                        <Select label={t`Max Lateness`} {...field}>
                          {latenessOptions.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                              {opt.description}
                            </MenuItem>
                          ))}
                        </Select>
                      )}
                    />

                    <FormHelperText>
                      <Trans>
                        If a previous slot ran long, should this slot still
                        play? Controls how late a slot can start.
                      </Trans>
                    </FormHelperText>
                  </FormControl>
                </Grid>
                <Grid size={{ sm: 16, md: 5 }}>
                  <FormControl fullWidth margin="normal">
                    <InputLabel>
                      <Trans>Max Overflow</Trans>
                    </InputLabel>
                    <Controller
                      control={control}
                      name="overflow"
                      render={({ field }) => (
                        <Select
                          label={t`Max Overflow`}
                          value={overflowToDropdownValue(field.value)}
                          onChange={(e) =>
                            field.onChange(
                              dropdownValueToOverflow(e.target.value),
                            )
                          }
                        >
                          {overflowOptions.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                              {opt.description}
                            </MenuItem>
                          ))}
                        </Select>
                      )}
                    />

                    <FormHelperText>
                      <Trans>
                        How far past its boundary can a slot's content extend?
                        'One extra item' allows exactly one more program that
                        crosses the boundary.
                      </Trans>
                    </FormHelperText>
                  </FormControl>
                </Grid>
                <Grid size={{ sm: 16, md: 5 }}>
                  <FormControl fullWidth margin="normal">
                    <InputLabel>
                      <Trans>Pad Times</Trans>
                    </InputLabel>
                    <Controller
                      control={control}
                      name="padMs"
                      render={({ field }) => (
                        <Select label={t`Pad Times`} {...field}>
                          {padOptions.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                              {opt.description}
                            </MenuItem>
                          ))}
                        </Select>
                      )}
                    />

                    <FormHelperText>
                      <Trans>
                        Ensures programs have a nice-looking start time, it will
                        add Flex time to fill the gaps.
                      </Trans>
                    </FormHelperText>
                  </FormControl>
                </Grid>

                <Grid size={{ sm: 16, md: 5 }}>
                  <FormControl fullWidth margin="normal">
                    <InputLabel>
                      <Trans>Flex Style</Trans>
                    </InputLabel>
                    <Controller
                      control={control}
                      name="flexPreference"
                      render={({ field }) => (
                        <Select label={t`Flex Style`} {...field}>
                          {flexOptions.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                              {opt.description}
                            </MenuItem>
                          ))}
                        </Select>
                      )}
                    />
                    <FormHelperText>
                      <Trans>
                        Usually slots need to add flex time to ensure that the
                        next slot starts at the correct time. When there are
                        multiple videos in the slot, you might prefer to
                        distribute the flex time between the videos or to place
                        most of the flex time at the end of the slot.
                      </Trans>
                    </FormHelperText>
                  </FormControl>
                </Grid>
                <Grid size={{ sm: 16, md: 5 }}>
                  <FormGroup row>
                    <NumericFormControllerText
                      control={control}
                      name="maxDays"
                      prettyFieldName={t`Days to Precalculate`}
                      TextFieldProps={{
                        label: t`Days to Precalculate`,
                        fullWidth: true,
                        margin: 'normal',
                      }}
                    />

                    <FormHelperText sx={{ ml: 1 }}>
                      <Trans>
                        Maximum number of days to precalculate the schedule.
                        Note that the length of the schedule is also bounded by
                        the maximum number of programs allowed in a channel.
                        <br />
                        <strong>
                          Note: Previewing the schedule in the browser for long
                          lengths of time can cause UI performance issues
                        </strong>
                      </Trans>
                    </FormHelperText>
                  </FormGroup>
                </Grid>
              </Grid>
            </Box>
          </Collapse>
          <Divider sx={{ my: 4 }} />
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
            <Button
              variant="outlined"
              onClick={() => calculateSlots()}
              disabled={isCalculatingSlots}
              startIcon={isCalculatingSlots ? <LoadingIcon /> : <Autorenew />}
            >
              <Trans>Refresh Preview</Trans>
            </Button>
          </Box>
        </PaddedPaper>
        <PaddedPaper>
          <Typography sx={{ mb: 1 }}>
            <Trans>Programming Preview</Trans>
          </Typography>
          <Divider sx={{ mb: 1 }} />
          <DateTimePicker
            label={t`Programming Start`}
            value={startTime}
            disabled
            slotProps={{ textField: { size: 'small' } }}
          />
          <ChannelLineupList
            type="selector"
            enableDnd={false}
            enableRowDelete={false}
            enableRowEdit={false}
            virtualListProps={{
              width: '100%',
              height: 600,
              itemSize: smallViewport ? 70 : 35,
              overscanCount: 5,
            }}
          />
        </PaddedPaper>
      </Stack>
    </SettingsForm>
  );
}
