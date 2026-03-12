import { useCallback, useMemo, memo } from 'react';
import { getEndpointField } from 'librechat-data-provider';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import type { TEndpointsConfig, TInterfaceConfig } from 'librechat-data-provider';
import useSideNavLinks from '~/hooks/Nav/useSideNavLinks';
import { useLocalize } from '~/hooks';
import { useGetEndpointsQuery } from '~/data-provider';
import { useSidePanelContext } from '~/Providers';
import { cn } from '~/utils';
import Nav from './Nav';

const SidePanel = ({
  fullCollapse,
  closeSidePanel,
  interfaceConfig,
}: {
  fullCollapse: boolean;
  closeSidePanel: () => void;
  interfaceConfig: TInterfaceConfig;
}) => {
  const localize = useLocalize();
  const { endpoint } = useSidePanelContext();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();

  const { data: keyExpiry = { expiresAt: undefined } } = useUserKeyQuery(endpoint ?? '');

  const defaultActive = useMemo(() => {
    const activePanel = localStorage.getItem('side:active-panel');
    return typeof activePanel === 'string' ? activePanel : undefined;
  }, []);

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, endpoint, 'type'),
    [endpoint, endpointsConfig],
  );

  const userProvidesKey = useMemo(
    () => !!(endpointsConfig?.[endpoint ?? '']?.userProvide ?? false),
    [endpointsConfig, endpoint],
  );
  const keyProvided = useMemo(
    () => (userProvidesKey ? !!(keyExpiry.expiresAt ?? '') : true),
    [keyExpiry.expiresAt, userProvidesKey],
  );

  const hidePanel = useCallback(() => {
    closeSidePanel();
  }, [closeSidePanel]);

  const Links = useSideNavLinks({
    endpoint,
    hidePanel,
    keyProvided,
    endpointType,
    interfaceConfig,
    endpointsConfig,
  });

  return (
    <nav
      id="controls-nav"
      aria-label={localize('com_ui_controls')}
      role="navigation"
      aria-hidden={fullCollapse}
      className={cn(
        'hide-scrollbar fixed right-0 top-0 z-[66] h-full w-[calc(100vw-0.75rem)] max-w-[352px] overflow-y-auto border-l border-border-light bg-background py-1 transition-transform duration-200 ease-in-out',
        fullCollapse ? 'translate-x-full' : 'translate-x-0',
      )}
    >
      <Nav isCollapsed={fullCollapse} defaultActive={defaultActive} links={Links} />
    </nav>
  );
};

export default memo(SidePanel);
