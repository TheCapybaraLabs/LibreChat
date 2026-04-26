import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SystemRoles } from 'librechat-data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import InvitesPanel from './InvitesPanel';

export default function InvitesDashboard() {
  const navigate = useNavigate();
  const localize = useLocalize();
  const { user } = useAuthContext();

  useEffect(() => {
    if (user && user.role !== SystemRoles.ADMIN) {
      navigate('/c/new', { replace: true });
    }
  }, [user, navigate]);

  if (!user || user.role !== SystemRoles.ADMIN) {
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-surface-primary">
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
        <button
          type="button"
          onClick={() => navigate('/c/new')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          aria-label={localize('com_ui_back')}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {localize('com_ui_back')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <InvitesPanel />
      </div>
    </div>
  );
}
