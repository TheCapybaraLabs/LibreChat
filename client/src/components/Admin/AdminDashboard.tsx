import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import DashBreadcrumb from '~/routes/Layouts/DashBreadcrumb';
import { useAuthContext } from '~/hooks';
import InvitesPanel from './InvitesPanel';

export default function AdminDashboard() {
  const navigate = useNavigate();
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
      <DashBreadcrumb />
      <div className="flex-1 overflow-y-auto">
        <InvitesPanel />
      </div>
    </div>
  );
}
