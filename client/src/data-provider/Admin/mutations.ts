import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type { UseMutationOptions } from '@tanstack/react-query';
import type { CreateAdminInviteResponse } from 'librechat-data-provider';

export const useCreateAdminInviteMutation = (
  options?: UseMutationOptions<CreateAdminInviteResponse, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<CreateAdminInviteResponse, Error, string>(
    [MutationKeys.createAdminInvite],
    (email: string) => dataService.createAdminInvite(email),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.adminInvites]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useRevokeAdminInviteMutation = (
  options?: UseMutationOptions<void, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>(
    [MutationKeys.revokeAdminInvite],
    (id: string) => dataService.revokeAdminInvite(id),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.adminInvites]);
        options?.onSuccess?.(...params);
      },
    },
  );
};
