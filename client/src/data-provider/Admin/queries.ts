import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import type { AdminInvite } from 'librechat-data-provider';

export const useGetAdminInvitesQuery = (
  config?: UseQueryOptions<AdminInvite[]>,
): QueryObserverResult<AdminInvite[]> => {
  return useQuery<AdminInvite[]>([QueryKeys.adminInvites], () => dataService.getAdminInvites(), {
    refetchOnWindowFocus: false,
    ...config,
  });
};
