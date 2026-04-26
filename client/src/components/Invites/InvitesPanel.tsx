import { useState } from 'react';
import { useToastContext } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { NotificationSeverity } from '~/common';
import {
  useGetInvitesQuery,
  useCreateInviteMutation,
  useRevokeInviteMutation,
} from '~/data-provider';

export default function InvitesPanel() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [email, setEmail] = useState('');

  const { data: invites = [], isLoading } = useGetInvitesQuery();

  const createInvite = useCreateInviteMutation({
    onSuccess: () => {
      setEmail('');
      showToast({
        message: localize('com_admin_invite_sent'),
        severity: NotificationSeverity.SUCCESS,
      });
    },
    onError: () => {
      showToast({
        message: localize('com_admin_invite_error'),
        severity: NotificationSeverity.ERROR,
      });
    },
  });

  const revokeInvite = useRevokeInviteMutation({
    onError: () => {
      showToast({
        message: localize('com_admin_invite_error'),
        severity: NotificationSeverity.ERROR,
      });
    },
  });

  const handleSend = () => {
    if (!email.includes('@')) return;
    createInvite.mutate(email);
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-lg font-semibold text-text-primary">
        {localize('com_admin_invite_users')}
      </h2>

      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={localize('com_admin_invite_email_placeholder')}
          className="flex-1 rounded-md border border-border-medium bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-border-heavy"
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          aria-label={localize('com_admin_invite_email_placeholder')}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={createInvite.isLoading || !email.includes('@')}
          className="rounded-md bg-surface-submit px-4 py-2 text-sm font-medium text-white hover:bg-surface-submit-hover disabled:opacity-50"
        >
          {localize('com_admin_invite_send')}
        </button>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium text-text-secondary">
          {localize('com_admin_invite_pending')}
        </h3>
        {isLoading ? (
          <div className="text-sm text-text-secondary">…</div>
        ) : invites.length === 0 ? (
          <div className="text-sm text-text-secondary">
            {localize('com_admin_invite_no_pending')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-medium text-left text-text-secondary">
                <th className="pb-2 pr-4 font-medium">{localize('com_admin_invite_email')}</th>
                <th className="pb-2 pr-4 font-medium">{localize('com_admin_invite_sent_at')}</th>
                <th className="pb-2 pr-4 font-medium">{localize('com_admin_invite_expires')}</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite._id} className="border-b border-border-light">
                  <td className="py-2 pr-4 text-text-primary">{invite.email}</td>
                  <td className="py-2 pr-4 text-text-secondary">{fmt(invite.createdAt)}</td>
                  <td className="py-2 pr-4 text-text-secondary">{fmt(invite.expiresAt)}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => revokeInvite.mutate(invite._id)}
                      disabled={revokeInvite.isLoading}
                      className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
                      aria-label={`${localize('com_admin_invite_revoke')} ${invite.email}`}
                    >
                      {localize('com_admin_invite_revoke')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
