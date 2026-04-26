import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type { UseMutationOptions } from '@tanstack/react-query';
import type { CreateInviteResponse } from 'librechat-data-provider';

export const useCreateInviteMutation = (
  options?: UseMutationOptions<CreateInviteResponse, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<CreateInviteResponse, Error, string>(
    [MutationKeys.createInvite],
    (email: string) => dataService.createInvite(email),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.invites]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useRevokeInviteMutation = (options?: UseMutationOptions<void, Error, string>) => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>(
    [MutationKeys.revokeInvite],
    (id: string) => dataService.revokeInvite(id),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.invites]);
        options?.onSuccess?.(...params);
      },
    },
  );
};
