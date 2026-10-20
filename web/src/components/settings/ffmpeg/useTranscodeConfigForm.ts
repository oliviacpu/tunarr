import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import type { TranscodeConfig } from '@tunarr/types';
import { TranscodeConfigSchema } from '@tunarr/types/schemas';
import { isEqual, omit } from 'lodash-es';
import { useEffect } from 'react';
import type { SubmitHandler } from 'react-hook-form';
import { useForm, useFormContext } from 'react-hook-form';
import type z from 'zod';
import {
  postApiTranscodeConfigsMutation,
  putApiTranscodeConfigsByIdMutation,
} from '../../../generated/@tanstack/react-query.gen.ts';

/**
 * What the transcode config form holds. A number field holds what was typed
 * until it parses, so its value is not always a number; the schema turns the
 * values into a `TranscodeConfig` when the form is validated and saved.
 */
export type TranscodeConfigFormValues = z.input<typeof TranscodeConfigSchema>;

/** The transcode config form, for the sections inside it. */
export const useTranscodeConfigFormContext = () =>
  useFormContext<TranscodeConfigFormValues, unknown, TranscodeConfig>();

type Options = {
  /** The saved config, or the defaults of a new one. */
  initialConfig: TranscodeConfigFormValues;
  isNew: boolean;
};

/**
 * The transcode config form and its save. A new config is created, then the
 * page moves to its edit route; an existing one is updated in place.
 */
export function useTranscodeConfigForm({ initialConfig, isNew }: Options) {
  const navigate = useNavigate();
  const form = useForm<TranscodeConfigFormValues, unknown, TranscodeConfig>({
    // The schema the server checks the config against, so the form refuses
    // what the server would
    resolver: zodResolver(TranscodeConfigSchema),
    defaultValues: initialConfig,
    mode: 'onChange',
  });
  const {
    reset,
    formState: { defaultValues },
  } = form;

  // Load the saved config into the form. The reload after a save brings back
  // what the form already compares against, so it is skipped: resetting again
  // would drop edits made while the save was in flight
  useEffect(() => {
    if (!isEqual(initialConfig, defaultValues)) {
      reset(initialConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConfig, reset]);

  // The config list and every loaded config
  const invalidate = {
    predicate: invalidateTaggedQueries('Transcode Configs'),
  };

  const createMutation = useSettingsMutation({
    form,
    mutation: {
      ...postApiTranscodeConfigsMutation(),
      // The save has reset the form, but the unsaved guard keeps the state
      // from before it until it renders again, so it would stop this. Replace
      // the new-config entry, so going back doesn't open a form that creates
      // the config a second time
      onSuccess: (created) =>
        navigate({
          to: '/settings/ffmpeg/$configId',
          params: { configId: created.id },
          replace: true,
          ignoreBlocker: true,
        }),
    },
    toFormValues: (created) => created,
    invalidate,
  });

  const updateMutation = useSettingsMutation({
    form,
    mutation: putApiTranscodeConfigsByIdMutation(),
    toFormValues: (saved) => saved,
    invalidate,
  });

  const save: SubmitHandler<TranscodeConfig> = (config) => {
    if (isNew) {
      // The server gives the new config its id
      createMutation.mutate({ body: omit(config, 'id') });
    } else {
      updateMutation.mutate({
        path: { id: initialConfig.id },
        body: config,
      });
    }
  };

  return {
    form,
    save,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}
