import { z } from 'zod/v4';
import { RandomSlotScheduleSchema } from './RandomSlots.js';
import { TimeSlotScheduleSchema } from './TimeSlots.js';

//
// Lineups
//
export const LineupScheduleSchema = z.discriminatedUnion('type', [
  TimeSlotScheduleSchema,
  RandomSlotScheduleSchema,
]);

export type LineupSchedule = z.infer<typeof LineupScheduleSchema>;

//
// Tools
//

const BaseSchedulingOpertionSchema = z.object({
  allowMultiple: z.boolean().default(true).optional(),
});

const BaseSortOperationSchema = (defaultAsc: boolean = true) =>
  z.object({
    type: z.literal('ordering'),
    ascending: z.boolean().optional().default(defaultAsc).catch(defaultAsc),
  });

const RandomSortOrderOperationSchema = BaseSchedulingOpertionSchema.extend({
  type: z.literal('ordering'),
  id: z.literal('random_sort'),
});

export type RandomSortOrderOperation = z.infer<
  typeof RandomSortOrderOperationSchema
>;

const ReleaseDateSortOrderOperationSchema = BaseSchedulingOpertionSchema.merge(
  BaseSortOperationSchema(),
).extend({
  id: z.literal('release_date_sort'),
});

export type ReleaseDateSortOrderOperation = z.infer<
  typeof ReleaseDateSortOrderOperationSchema
>;

const ScheduledRedirectOperationSchema = BaseSchedulingOpertionSchema.extend({
  type: z.literal('modifier'),
  id: z.literal('scheduled_redirect'),
  channelId: z.string().uuid(),
  startHour: z.number().min(0).max(23),
  // Anything less than 30 mins doesn't really make sense?
  // And can't schedule more than 24 hours either...
  duration: z
    .number()
    .min(15 * 60 * 1000)
    .max(24 * 60 * 60 * 1000),
});

export type ScheduledRedirectOperation = z.infer<
  typeof ScheduledRedirectOperationSchema
>;

const AddPaddingOperationSchema = BaseSchedulingOpertionSchema.extend({
  type: z.literal('modifier'), // not sure I like this name yet
  id: z.literal('add_padding'), // every operation needs a unique ID
  mod: z.number(),
  allowedOffsets: z.array(z.number()).optional(),
  alignChannelStartTime: z.boolean().default(false),
  allowMultiple: z.literal(false).default(false).optional(),
});

export type AddPaddingOperation = z.infer<typeof AddPaddingOperationSchema>;

export const SchedulingOperationSchema = z.union([
  AddPaddingOperationSchema,
  ScheduledRedirectOperationSchema,
  RandomSortOrderOperationSchema,
  ReleaseDateSortOrderOperationSchema,
]);

export type SchedulingOperation = z.infer<typeof SchedulingOperationSchema>;
