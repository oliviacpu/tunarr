import { z } from 'zod/v4';
import { canonicalLanguageCode } from './languageSchema.js';

export const SubtitleFilterSchema = z.enum([
  'none',
  'forced',
  'default',
  'any',
]);

export const SubtitlePreference = z.object({
  langugeCode: z.string(),
  priority: z.number().nonnegative(),
  allowImageBased: z.boolean(),
  allowExternal: z.boolean(),
  filter: SubtitleFilterSchema.default('any'),
});

export const GlobalSubtitlePreferenceSchema = z.object({
  languageCode: z
    .string()
    .refine((code) => canonicalLanguageCode(code) !== null, {
      message: 'Use a known lowercase three-letter ISO 639-2 language code',
    })
    .overwrite((code) => canonicalLanguageCode(code) ?? code),
  filter: SubtitleFilterSchema,
  allowExternal: z.boolean(),
  allowImageBased: z.boolean(),
});
