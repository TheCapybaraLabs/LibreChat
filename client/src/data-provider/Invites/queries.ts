import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import type { Invite } from 'librechat-data-provider';

export const useGetInvitesQuery = (
  config?: UseQueryOptions<Invite[]>,
): QueryObserverResult<Invite[]> => {
  return useQuery<Invite[]>([QueryKeys.invites], () => dataService.getInvites(), {
    refetchOnWindowFocus: false,
    ...config,
  });
};
