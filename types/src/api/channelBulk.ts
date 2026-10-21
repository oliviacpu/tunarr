import { z } from 'zod/v4';

export const BulkChannelIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Channel IDs must be unique',
  });

export const BulkChannelStealthRequestSchema = z.object({
  ids: BulkChannelIdsSchema,
  stealth: z.boolean(),
});

export const BulkChannelItemResultSchema = z.discriminatedUnion('success', [
  z.object({ id: z.uuid(), success: z.literal(true) }),
  z.object({
    id: z.uuid(),
    success: z.literal(false),
    statusCode: z.union([z.literal(404), z.literal(500)]),
    message: z.string(),
  }),
]);

export const BulkChannelRefreshStatusSchema = z.enum([
  'succeeded',
  'failed',
  'not_needed',
]);

export const BulkChannelStealthResponseSchema = z.object({
  results: z.array(BulkChannelItemResultSchema),
  refresh: z.object({
    xmltv: BulkChannelRefreshStatusSchema,
    m3u: BulkChannelRefreshStatusSchema,
  }),
});

export type BulkChannelIds = z.infer<typeof BulkChannelIdsSchema>;
export type BulkChannelStealthRequest = z.infer<
  typeof BulkChannelStealthRequestSchema
>;
export type BulkChannelItemResult = z.infer<typeof BulkChannelItemResultSchema>;
export type BulkChannelRefreshStatus = z.infer<
  typeof BulkChannelRefreshStatusSchema
>;
export type BulkChannelStealthResponse = z.infer<
  typeof BulkChannelStealthResponseSchema
>;
