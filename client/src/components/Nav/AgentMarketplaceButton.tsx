import React, { useCallback, useContext } from 'react';
import { useSetRecoilState } from 'recoil';
import { Gem } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { TooltipAnchor, Button } from '@librechat/client';
import { useLocalize, useHasAccess, AuthContext } from '~/hooks';
import store from '~/store';

interface AgentMarketplaceButtonProps {
  isSmallScreen?: boolean;
  toggleNav: () => void;
}

export default function AgentMarketplaceButton({
  isSmallScreen,
  toggleNav,
}: AgentMarketplaceButtonProps) {
  const navigate = useNavigate();
  const localize = useLocalize();
  const authContext = useContext(AuthContext);
  const requestCloseRightSidePanel = useSetRecoilState(store.rightSidePanelCloseNonce);

  const hasAccessToAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });

  const hasAccessToMarketplace = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });

  const handleAgentMarketplace = useCallback(() => {
    localStorage.setItem('fullPanelCollapse', 'true');
    localStorage.setItem('react-resizable-panels:collapsed', 'true');
    requestCloseRightSidePanel((value) => value + 1);
    navigate('/agents');
    if (isSmallScreen) {
      toggleNav();
    }
  }, [navigate, isSmallScreen, toggleNav, requestCloseRightSidePanel]);

  // Check if auth is ready (avoid race conditions)
  const authReady =
    authContext?.isAuthenticated !== undefined &&
    (authContext?.isAuthenticated === false || authContext?.user !== undefined);

  // Show agent marketplace when marketplace permission is enabled, auth is ready, and user has access to agents
  const showAgentMarketplace = authReady && hasAccessToAgents && hasAccessToMarketplace;

  if (!showAgentMarketplace) {
    return null;
  }

  return (
    <TooltipAnchor
      description={localize('com_agents_marketplace')}
      render={
        <Button
          size="default"
          variant="outline"
          data-testid="nav-agents-marketplace-button"
          aria-label={localize('com_agents_marketplace')}
          className="rounded-xl w-full border border-border-light bg-surface-secondary p-3 hover:bg-surface-hover"
          onClick={handleAgentMarketplace}
        >
          <Gem className="icon-md text-text-primary" />
          {localize('com_ui_agents')}
        </Button>
      }
    />
  );
}
