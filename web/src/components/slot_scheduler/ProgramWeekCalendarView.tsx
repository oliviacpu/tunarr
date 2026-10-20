import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
} from '@mui/icons-material';
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { seq } from '@tunarr/shared/util';
import type { ContentProgram } from '@tunarr/types';
import { usePrevious } from '@uidotdev/usehooks';
import dayjs from 'dayjs';
import dayOfYear from 'dayjs/plugin/dayOfYear';
import 'dayjs/plugin/duration';
import 'dayjs/plugin/localeData';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { range } from 'lodash-es';
import { useCallback, useMemo, useRef, useState } from 'react';
import { P, match } from 'ts-pattern';
import { programSeasonAndEpisode } from '../../helpers/formatters.ts';
import { extractProgramGrandparent } from '../../helpers/programUtil.ts';
import { useGetProgramsForDayFunc } from '../../hooks/calendarHooks.ts';
import { useActivePalette } from '../../hooks/useTunarrTheme.ts';
import { useDayjs } from '../../hooks/useDayjs.ts';
import { useSuspendedStore } from '../../hooks/useSuspendedStore.ts';
import ProgramDetailsDialog from '../programs/ProgramDetailsDialog.tsx';
import { channelProgramStyle } from '../guide/guideColors.ts';

dayjs.extend(weekOfYear);
dayjs.extend(dayOfYear);

const OneDayMillis = dayjs.duration(1, 'day').asMilliseconds();

const DayWidth = 145;
export const DefaultBlockHeight = 48;
export const LeftDividerWidth = 8;

type Props = {
  calendarState?: dayjs.Dayjs;
  onChange?: (day: dayjs.Dayjs) => void;
  onSelectDay?: (day: dayjs.Dayjs) => void;
};

function isSameDay(l: dayjs.Dayjs, r: dayjs.Dayjs) {
  return (
    l.year() === r.year() && l.month() === r.month() && l.date() === r.date()
  );
}

export const ProgramWeekCalendarView = ({
  calendarState: providedCalendarState,
  onChange,
  onSelectDay,
}: Props) => {
  const providedDjs = useDayjs();
  const now = providedDjs();
  const localeData = useMemo(() => providedDjs().localeData(), [providedDjs]);
  const prevCalendarDate = usePrevious(!!providedCalendarState);
  const isControlled = !!providedCalendarState;

  if (prevCalendarDate !== null && prevCalendarDate !== isControlled) {
    console.error(
      'Cannot switch between uncontrolled and controlled ProgramCalendarView.',
    );
  }

  const [internalCalendarState, setInternalCalendarState] =
    useState<dayjs.Dayjs>(providedDjs().startOf('week'));
  const calendarState =
    providedCalendarState?.startOf('week') ?? internalCalendarState;
  const [blockHeight, setBlockHeight] = useState(DefaultBlockHeight);

  const [openProgramDetails, setOpenProgramDetails] =
    useState<ContentProgram | null>(null);

  const startOfWeek = useMemo(
    () => calendarState.startOf('week'),
    [calendarState],
  );

  const channel = useSuspendedStore((s) => s.channelEditor.currentEntity);
  const calRef = useRef<HTMLDivElement | null>(null);

  const fmt = Intl.DateTimeFormat(providedDjs().locale(), {
    hour: 'numeric',
    minute: undefined,
  });

  const calHeight = calRef?.current?.getBoundingClientRect().height;

  const getCalendarProgramsForDay = useGetProgramsForDayFunc(channel.id);

  const goToToday = useCallback(() => {
    onChange?.(now);
    setInternalCalendarState(now);
  }, [onChange, now]);

  const moveBackwardDays = useCallback(
    (n: number = 1) => {
      const next = calendarState.subtract(n, 'days');
      onChange?.(next);
      setInternalCalendarState(next);
    },
    [calendarState, onChange],
  );

  const moveForwardDays = useCallback(
    (n: number = 1) => {
      const next = calendarState.add(n, 'days');
      onChange?.(next);
      setInternalCalendarState(next);
    },
    [calendarState, onChange],
  );

  const palette = useActivePalette();

  const getProgramsForDay = (day: dayjs.Dayjs) => {
    return seq.collect(
      getCalendarProgramsForDay(day),
      ({ duration, howFarIntoDay, actualStartTime, program }) => {
        if (program.type === 'flex') return null;

        const height = (duration / OneDayMillis) * 100;

        const px = (calHeight ?? 0) * (duration / OneDayMillis);
        const dataRows = Math.floor((px - 8) / 15);

        const cellStyle = channelProgramStyle(palette, program);
        return (
          <Paper
            key={+actualStartTime}
            sx={{
              position: 'absolute',
              top: `${(howFarIntoDay / OneDayMillis) * 100}%`,
              left: 0,
              width: '90%',
              height: `${height}%`,
              backgroundColor: cellStyle.background,
              borderRadius: '5px',
              zIndex: 100,
              border: `1px solid ${palette.divider}`,
              cursor: 'pointer',
              color: cellStyle.color,
              overflow: 'hidden',
              lineHeight: 1,
              px: 0.5,
            }}
            onClick={() =>
              program.type === 'content'
                ? setOpenProgramDetails(program)
                : void 0
            }
            elevation={
              program.type === 'content' &&
              openProgramDetails?.id === program.id
                ? 10
                : 0
            }
          >
            <Box
              component="span"
              sx={{
                fontSize: 'small',
                fontWeight: 'bold',
                textOverflow: 'clip',
                overflowX: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {program.type === 'content'
                ? (extractProgramGrandparent(program.program)?.title ??
                  program.program.title)
                : ''}
            </Box>
            {dataRows > 1 && (
              <>
                <br />
                {program.type === 'content' &&
                  program.program.type === 'episode' && (
                    <Box
                      component="span"
                      sx={{
                        fontSize: 'small',
                        fontWeight: 'bold',
                        textOverflow: 'clip',
                        overflowX: 'hidden',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {programSeasonAndEpisode(program.program)}
                    </Box>
                  )}
                {program.type === 'content' &&
                  program.program.type === 'movie' && (
                    <Box
                      component="span"
                      sx={{
                        fontSize: 'small',
                        fontWeight: 'bold',
                        textOverflow: 'clip',
                        overflowX: 'hidden',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {actualStartTime.format('LT')}
                    </Box>
                  )}
              </>
            )}
          </Paper>
        );
      },
    );
  };

  const end = calendarState.add(1, 'week').subtract(1, 'day');

  const getCalendarHeader = () => {
    const sameMonth = end.month() === calendarState.month();
    const sameYear = end.year() === calendarState.year();

    return match([sameMonth, sameYear])
      .with([true, true], () => `${calendarState.format('MMM YYYY')}`)
      .with(
        [false, true],
        () =>
          `${calendarState.format('MMM')} - ${end.format('MMM')} ${calendarState.format('YYYY')}`,
      )
      .with(
        [P._, false],
        () => `${calendarState.format('MMM YYYY')} - ${end.format('MMM YYYY')}`,
      )
      .exhaustive();
  };

  const renderWeekHeader = (idx: number) => {
    const weekDay = startOfWeek.add(idx, 'days');
    const isToday = isSameDay(weekDay, now);
    return (
      <Box
        key={`week_header_${idx}`}
        data-week-header={idx}
        sx={{ textAlign: 'center', flex: `1 0 ${DayWidth}px` }}
      >
        <Typography component="span">
          {localeData.weekdaysShort()[idx]}
        </Typography>
        <br />
        <Typography
          component="span"
          variant="h5"
          sx={{
            backgroundColor: (theme) =>
              isToday ? theme.palette.primary.main : 'transparent',
            color: (theme) =>
              isToday
                ? theme.palette.getContrastText(theme.palette.primary.main)
                : theme.palette.text.primary,
            '&:hover': {
              cursor: 'pointer',
              backgroundColor: (theme) =>
                !isToday ? theme.palette.grey[300] : undefined,
            },
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            display: 'inline-flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onClick={() => onSelectDay?.(weekDay)}
        >
          {weekDay.date()}
        </Typography>
      </Box>
    );
  };

  return (
    <Stack
      sx={{ width: '100%', minWidth: 0, fontVariantNumeric: 'tabular-nums' }}
      gap={2}
    >
      <Stack
        direction="row"
        sx={{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1 }}
      >
        <Button onClick={() => goToToday()} variant="contained">
          <Trans>Today</Trans>
        </Button>
        <IconButton onClick={() => moveBackwardDays(7)}>
          <ChevronLeft />
        </IconButton>
        <IconButton onClick={() => moveForwardDays(7)}>
          <ChevronRight />
        </IconButton>
        <Typography
          variant="h5"
          flex={1}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          {getCalendarHeader()}
        </Typography>
        <Box sx={{ display: 'flex', flexShrink: 0 }}>
          <IconButton onClick={() => setBlockHeight((prev) => prev - 8)}>
            <ZoomOut />
          </IconButton>
          <IconButton onClick={() => setBlockHeight((prev) => prev + 8)}>
            <ZoomIn />
          </IconButton>
        </Box>
      </Stack>
      <Box
        role="region"
        aria-label={t`Week calendar`}
        tabIndex={0}
        sx={{ overflowX: 'auto', minWidth: 0 }}
      >
        <Box sx={{ minWidth: blockHeight + LeftDividerWidth + 7 * DayWidth }}>
          <Stack direction="row">
            <Box
              sx={{
                width: blockHeight + LeftDividerWidth,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 1,
                backgroundColor: 'background.paper',
              }}
            ></Box>
            <Stack
              sx={{
                '--Grid-borderWidth': '1px',
                flex: 1,
                minWidth: 0,
              }}
              direction="row"
            >
              {range(0, 7).map((idx) => renderWeekHeader(idx))}
            </Stack>
          </Stack>
          <Stack direction="row">
            <Stack
              sx={{
                width: blockHeight,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 1,
                backgroundColor: 'background.paper',
              }}
            >
              {range(0, 24).map((hour) => (
                <Box
                  sx={{
                    height: `${blockHeight}px`,
                    lineHeight: 1,
                  }}
                  key={`side_hour_${hour}`}
                >
                  <Box
                    component="span"
                    sx={{
                      position: 'relative',
                      top: '-6px',
                      fontSize: '0.9rem',
                    }}
                  >
                    {hour === 0
                      ? null
                      : fmt.format(startOfWeek.hour(hour).toDate())}
                  </Box>
                </Box>
              ))}
            </Stack>
            <Stack
              sx={{
                '--Grid-borderWidth': '1px',
                borderColor: 'divider',
                minWidth: 0,
                flex: 1,
              }}
              direction="row"
              ref={calRef}
            >
              <Stack
                sx={{
                  width: LeftDividerWidth,
                  flexShrink: 0,
                  position: 'sticky',
                  left: blockHeight,
                  zIndex: 1,
                  backgroundColor: 'background.paper',
                }}
              >
                {range(0, 24).map((idx) => (
                  <Box
                    key={`divider_small_${idx}`}
                    sx={{
                      height: `${blockHeight}px`,
                      '--Grid-borderWidth': '1px',
                      borderTop: 'var(--Grid-borderWidth) solid',
                      borderColor: 'divider',
                    }}
                  ></Box>
                ))}
              </Stack>

              {range(0, 7).map((idx) => (
                <Stack
                  key={`week_${idx}`}
                  data-week-column={idx}
                  sx={{
                    minWidth: `${DayWidth}px`,
                    '--Grid-borderWidth': '1px',
                    borderTop: 'var(--Grid-borderWidth) solid',
                    borderLeft: 'var(--Grid-borderWidth) solid',
                    borderColor: 'divider',
                    zIndex: 0,
                    position: 'relative',
                    flex: `1 0 ${DayWidth}px`,
                  }}
                >
                  {range(0, 24).map((hour) => (
                    <Box
                      sx={{
                        height: `${blockHeight}px`,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        position: 'relative',
                      }}
                      key={`week_${idx}_hour_${hour}`}
                    ></Box>
                  ))}
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                    }}
                  >
                    {getProgramsForDay(startOfWeek.add(idx, 'days'))}
                  </Box>
                </Stack>
              ))}
            </Stack>
          </Stack>
        </Box>
      </Box>
      {(openProgramDetails?.type === 'content' ||
        (openProgramDetails?.type === 'custom' && openProgramDetails?.id)) && (
        <ProgramDetailsDialog
          programId={openProgramDetails?.id}
          programType={openProgramDetails?.program.type}
          open={!!openProgramDetails}
          onClose={() => setOpenProgramDetails(null)}
        />
      )}
    </Stack>
  );
};
