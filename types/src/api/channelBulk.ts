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

export const BulkChannelDeleteRequestSchema = z.object({
  ids: BulkChannelIdsSchema,
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

export const BulkChannelCleanupResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['succeeded', 'not_needed']) }),
  z.object({ status: z.literal('failed'), message: z.string() }),
]);

export const BulkChannelDeleteItemResultSchema = z.discriminatedUnion(
  'success',
  [
    BulkChannelItemResultSchema.options[0].extend({
      cleanup: BulkChannelCleanupResultSchema,
    }),
    BulkChannelItemResultSchema.options[1].extend({
      cleanup: BulkChannelCleanupResultSchema,
    }),
  ],
);

export const BulkChannelDeleteResponseSchema = z.object({
  results: z.array(BulkChannelDeleteItemResultSchema),
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
export type BulkChannelDeleteRequest = z.infer<
  typeof BulkChannelDeleteRequestSchema
>;
export type BulkChannelCleanupResult = z.infer<
  typeof BulkChannelCleanupResultSchema
>;
export type BulkChannelDeleteItemResult = z.infer<
  typeof BulkChannelDeleteItemResultSchema
>;
export type BulkChannelDeleteResponse = z.infer<
  typeof BulkChannelDeleteResponseSchema
>;
