import { SlotScheduleResult, TimeSlotScheduleResult } from '@tunarr/types/api';
import { z } from 'zod/v4';
import {
  ChannelSlotScheduleRequest,
  ProgramsSlotScheduleRequest,
} from '../services/scheduling/RandomSlotSchedulerService.ts';
import {
  ChannelTimeSlotScheduleRequest,
  ProgramsTimeSlotScheduleRequest,
} from '../services/scheduling/TimeSlotSchedulerService.ts';

/**
 * A library scan as the scan coordinator hands it to a runner: IDs and flags
 * only, so it can cross a thread boundary. The runner re-reads the library or
 * media source when the job starts.
 */
export const ScanJob = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('library'),
    libraryId: z.string(),
    force: z.boolean(),
    pathFilter: z.string().optional(),
  }),
  z.object({
    kind: z.literal('local'),
    mediaSourceId: z.string(),
    force: z.boolean(),
    pathFilter: z.string().optional(),
  }),
  // A remote media source's collections, across its enabled libraries
  z.object({
    kind: z.literal('collections'),
    mediaSourceId: z.string(),
  }),
]);

export type ScanJob = z.infer<typeof ScanJob>;

export const ScanOutcome = z.enum(['completed', 'canceled', 'skipped']);

export type ScanOutcome = z.infer<typeof ScanOutcome>;

const BaseWorkerRequest = z.object({
  requestId: z.uuid(),
});

const WorkerRestartRequest = BaseWorkerRequest.extend({
  type: z.literal('restart'),
  code: z.number().optional(),
});

const WorkerStatusRequest = BaseWorkerRequest.extend({
  type: z.literal('status'),
});

export const WorkerScheduleTimeSlotsRequest = BaseWorkerRequest.extend({
  type: z.literal('time-slots'),
  request: z.discriminatedUnion('type', [
    ChannelTimeSlotScheduleRequest,
    ProgramsTimeSlotScheduleRequest,
  ]),
});

export type WorkerScheduleTimeSlotsRequest = z.infer<
  typeof WorkerScheduleTimeSlotsRequest
>;

export const WorkerScheduleSlotsRequest = z.object({
  ...BaseWorkerRequest.shape,
  type: z.literal('schedule-slots'),
  request: z.discriminatedUnion('type', [
    ChannelSlotScheduleRequest,
    ProgramsSlotScheduleRequest,
  ]),
});

export type WorkerScheduleSlotsRequest = z.infer<
  typeof WorkerScheduleSlotsRequest
>;

export const WorkerRequest = z.discriminatedUnion('type', [
  WorkerRestartRequest,
  WorkerStatusRequest,
  WorkerScheduleTimeSlotsRequest,
  WorkerScheduleSlotsRequest,
]);

export type WorkerRequest = z.infer<typeof WorkerRequest>;

export const WorkerEvent = z.object({
  type: z.literal('event'),
  eventType: z.enum(['started']),
  message: z.string().optional(),
});

export type WorkerEvent = z.infer<typeof WorkerEvent>;

// What a worker thread does: the round-robin pool (slot scheduling) or a
// single library scan
export const WorkerRole = z.enum(['pool', 'scan']);

export type WorkerRole = z.infer<typeof WorkerRole>;

// Main thread -> scan worker
export const ScanWorkerRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scan'), jobId: z.uuid(), job: ScanJob }),
  z.object({ type: z.literal('cancel'), jobId: z.uuid() }),
  z.object({ type: z.literal('shutdown') }),
]);

export type ScanWorkerRequest = z.infer<typeof ScanWorkerRequest>;

// Scan worker -> main thread. Progress mirrors MediaSourceProgressService's
// events for the library or media source being scanned.
export const ScanWorkerMessage = z.discriminatedUnion('type', [
  WorkerEvent,
  z.object({
    type: z.literal('scan-progress'),
    jobId: z.uuid(),
    entityId: z.string(),
    event: z.enum(['started', 'progress', 'ended']),
    percentComplete: z.number().min(0).max(100).optional(),
  }),
  z.object({
    type: z.literal('scan-done'),
    jobId: z.uuid(),
    outcome: ScanOutcome,
  }),
  z.object({
    type: z.literal('scan-failed'),
    jobId: z.uuid(),
    message: z.string(),
  }),
]);

export type ScanWorkerMessage = z.infer<typeof ScanWorkerMessage>;

const WorkerErrorReply = z.object({
  type: z.literal('error'),
  message: z.string(),
  requestId: z.string(),
  httpCode: z.number().optional(),
});

export type WorkerErrorReply = z.infer<typeof WorkerErrorReply>;

const WorkerStatusReply = z.object({
  type: z.literal('status'),
  status: z.enum(['healthy']),
});

export const WorkerTimeSlotScheduleReply = z.object({
  type: z.literal('time-slots'),
  result: TimeSlotScheduleResult,
});

export type WorkerTimeSlotScheduleReply = z.infer<
  typeof WorkerTimeSlotScheduleReply
>;

const WorkerSlotScheduleReply = z.object({
  type: z.literal('schedule-slots'),
  result: SlotScheduleResult,
});

export type WorkerSlotScheduleReply = z.infer<typeof WorkerSlotScheduleReply>;

export type WorkerStatusReply = z.infer<typeof WorkerStatusReply>;

export const WorkerSuccessReply = z.object({
  type: z.literal('success'),
  requestId: z.string(),
  data: z.discriminatedUnion('type', [
    WorkerStatusReply,
    WorkerTimeSlotScheduleReply,
    WorkerSlotScheduleReply,
  ]),
});

export type WorkerSuccessReply = z.infer<typeof WorkerSuccessReply>;

export const WorkerReply = z.discriminatedUnion('type', [
  WorkerErrorReply,
  WorkerSuccessReply,
]);

export type WorkerReply = z.infer<typeof WorkerReply>;

export const WorkerMessage = z.discriminatedUnion('type', [
  WorkerEvent,
  WorkerReply,
]);

export type WorkerMessage = z.infer<typeof WorkerMessage>;

export const WorkerRequestToResponse = {
  status: WorkerStatusReply,
  restart: z.void(),
  'time-slots': WorkerTimeSlotScheduleReply,
  'schedule-slots': WorkerSlotScheduleReply,
} as const;
