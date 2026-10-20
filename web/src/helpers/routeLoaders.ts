import { channelProgrammingQuery } from '@/hooks/useChannelLineup';
import { channelQuery } from '@/hooks/useChannels';
import {
  customShowProgramsQuery,
  customShowQuery,
} from '@/hooks/useCustomShows.ts';
import {
  fillerListProgramsQuery,
  fillerListQuery,
} from '@/hooks/useFillerLists.ts';
import useStore from '@/store';
import { safeSetCurrentChannel } from '@/store/channelEditor/actions';
import { setCurrentCustomShow } from '@/store/customShowEditor/actions.ts';
import { setCurrentFillerList } from '@/store/fillerListEditor/action.ts';
import { type RouterContext } from '@/types/RouterContext';
import { notFound } from '@tanstack/react-router';
import { isMissingEntityError } from './apiError.ts';

// Loads one thing a page is about. When it doesn't exist the loader throws
// notFound(), so the router shows its not-found page; any other failure goes
// to the router's error page.
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (isMissingEntityError(error)) {
      throw notFound();
    }
    throw error;
  }
}

export type ChannelArgs = {
  params: { channelId: string };
  context: RouterContext;
};

export async function preloadChannelAndProgramming({
  params,
  context,
}: ChannelArgs) {
  const [channel, programming] = await Promise.all([
    orNotFound(
      context.queryClient.ensureQueryData(channelQuery(params.channelId)),
    ),
    orNotFound(
      context.queryClient.ensureQueryData(
        channelProgrammingQuery(params.channelId, true),
      ),
    ),
  ]);

  safeSetCurrentChannel(channel, programming);
}

type FillerArgs = {
  params: { fillerId: string };
  context: RouterContext;
};

export async function preloadFillerAndProgramming({
  context: { queryClient },
  params: { fillerId },
}: FillerArgs) {
  // TODO if this is too slow we can use the router defer method
  const [fillerList, programming] = await Promise.all([
    orNotFound(queryClient.ensureQueryData(fillerListQuery(fillerId))),
    orNotFound(queryClient.ensureQueryData(fillerListProgramsQuery(fillerId))),
  ]);

  // Set state
  const currentList = useStore.getState().fillerListEditor.currentEntity;
  if (currentList?.id !== fillerList.id) {
    setCurrentFillerList(fillerList, programming);
  }

  return {
    fillerList,
    programming,
  };
}

type CustomShowArgs = {
  params: { showId: string };
  context: RouterContext;
};

export async function preloadCustomShowAndProgramming({
  context: { queryClient },
  params: { showId },
}: CustomShowArgs) {
  // TODO if this is too slow we can use the router defer method
  const [customShow, programming] = await Promise.all([
    orNotFound(queryClient.ensureQueryData(customShowQuery(showId))),
    orNotFound(queryClient.ensureQueryData(customShowProgramsQuery(showId))),
  ]);

  // Set state
  const currentShow = useStore.getState().customShowEditor.currentEntity;
  if (currentShow?.id !== customShow.id) {
    setCurrentCustomShow(customShow, programming);
  }

  return {
    customShow,
    programming,
  };
}
