import { orNotFound } from '@/helpers/routeLoaders.ts';
import {
  getApiProgramsByIdOptions,
  getApiProgramGroupingsByIdOptions,
} from '@/generated/@tanstack/react-query.gen.ts';
import { ProgramPage } from '@/pages/media/ProgramPage';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { isGroupingItemType, isTerminalItemType } from '@tunarr/types';

export const Route = createFileRoute('/media_/$programType/$programId')({
  gcTime: 0,
  // eslint-disable-next-line @typescript-eslint/require-await
  beforeLoad: async ({ params }) => {
    const { programType, programId } = params;
    if (!isTerminalItemType(programType) && !isGroupingItemType(programType)) {
      throw notFound();
    }
    return {
      programType: programType,
      programId,
    };
  },
  loader: ({ context: { queryClient }, params }) =>
    isTerminalItemType(params.programType)
      ? orNotFound(
          queryClient.fetchQuery(
            getApiProgramsByIdOptions({ path: { id: params.programId } }),
          ),
        )
      : orNotFound(
          queryClient.fetchQuery(
            getApiProgramGroupingsByIdOptions({
              path: { id: params.programId },
            }),
          ),
        ),
  component: ProgramPage,
});
