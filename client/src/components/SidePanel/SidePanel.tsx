import { useState, useCallback, useMemo, memo } from 'react';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import { ResizableHandleAlt, ResizablePanel, useMediaQuery } from '@librechat/client';
import type { TEndpointsConfig, TInterfaceConfig } from 'librechat-data-provider';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import useSideNavLinks from '~/hooks/Nav/useSideNavLinks';
import { useLocalStorage, useLocalize } from '~/hooks';
import { useGetEndpointsQuery } from '~/data-provider';
import NavToggle from '~/components/Nav/NavToggle';
import { useSidePanelContext } from '~/Providers';
import { cn, getEndpointField } from '~/utils';
import Nav from './Nav';

const defaultMinSize = 20;

const SidePanel = ({
  defaultSize,
  panelRef,
  navCollapsedSize = 3,
  hasArtifacts,
  minSize,
  setMinSize,
  collapsedSize,
  setCollapsedSize,
  isCollapsed,
  setIsCollapsed,
  fullCollapse,
  setFullCollapse,
  interfaceConfig,
}: {
  defaultSize?: number;
  hasArtifacts: boolean;
  navCollapsedSize?: number;
  minSize: number;
  setMinSize: React.Dispatch<React.SetStateAction<number>>;
  collapsedSize: number;
  setCollapsedSize: React.Dispatch<React.SetStateAction<number>>;
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  fullCollapse: boolean;
  setFullCollapse: React.Dispatch<React.SetStateAction<boolean>>;
  panelRef: React.RefObject<ImperativePanelHandle>;
  interfaceConfig: TInterfaceConfig;
}) => {
  const localize = useLocalize();
  const { endpoint } = useSidePanelContext();
  const [isHovering, setIsHovering] = useState(false);
  const [newUser, setNewUser] = useLocalStorage('newUser', true);
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();

  const isSmallScreen = useMediaQuery('(max-width: 767px)');

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
    setIsCollapsed(true);
    setCollapsedSize(0);
    setMinSize(defaultMinSize);
    setFullCollapse(true);
    localStorage.setItem('fullPanelCollapse', 'true');
    panelRef.current?.collapse();
  }, [panelRef, setMinSize, setIsCollapsed, setFullCollapse, setCollapsedSize]);

  const Links = useSideNavLinks({
    endpoint,
    hidePanel,
    keyProvided,
    endpointType,
    interfaceConfig,
    endpointsConfig,
  });

  const toggleNavVisible = useCallback(() => {
    if (newUser) {
      setNewUser(false);
    }
    setIsCollapsed((prev: boolean) => {
      if (prev) {
        setMinSize(defaultMinSize);
        setCollapsedSize(navCollapsedSize);
        setFullCollapse(false);
        localStorage.setItem('fullPanelCollapse', 'false');
      }
      return !prev;
    });
    if (!isCollapsed) {
      panelRef.current?.collapse();
    } else {
      panelRef.current?.expand();
    }
  }, [
    newUser,
    panelRef,
    setNewUser,
    setMinSize,
    isCollapsed,
    setIsCollapsed,
    setFullCollapse,
    setCollapsedSize,
    navCollapsedSize,
  ]);

  return (
    <>
      <div
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        className="relative flex w-px items-center justify-center"
      >
        <NavToggle
          navVisible={!isCollapsed}
          isHovering={isHovering}
          onToggle={toggleNavVisible}
          setIsHovering={setIsHovering}
          className={cn(
            'fixed top-1/2',
            (isCollapsed && (minSize === 0 || collapsedSize === 0)) || fullCollapse
              ? 'mr-9'
              : 'mr-16',
          )}
          translateX={false}
          side="right"
        />
      </div>
      {(!isCollapsed || minSize > 0) && !isSmallScreen && !fullCollapse && (
        <ResizableHandleAlt withHandle className="bg-transparent text-text-primary" />
      )}
      <ResizablePanel
        tagName="nav"
        id="controls-nav"
        order={hasArtifacts ? 3 : 2}
        aria-label={localize('com_ui_controls')}
        role="navigation"
        collapsedSize={collapsedSize}
        defaultSize={defaultSize}
        collapsible={true}
        minSize={minSize}
        maxSize={40}
        ref={panelRef}
        style={{
          overflowY: 'auto',
          transition: 'width 0.2s ease, visibility 0s linear 0.2s',
        }}
        onExpand={() => {
          setIsCollapsed(false);
          localStorage.setItem('react-resizable-panels:collapsed', 'false');
        }}
        onCollapse={() => {
          setIsCollapsed(true);
          localStorage.setItem('react-resizable-panels:collapsed', 'true');
        }}
        className={cn(
          'sidenav hide-scrollbar border-l border-border-light bg-background py-1 transition-opacity',
          isCollapsed ? 'min-w-[50px]' : 'min-w-[340px] sm:min-w-[352px]',
          (isSmallScreen && isCollapsed && (minSize === 0 || collapsedSize === 0)) || fullCollapse
            ? 'hidden min-w-0'
            : 'opacity-100',
        )}
      >
        <Nav
          resize={panelRef.current?.resize}
          isCollapsed={isCollapsed}
          defaultActive={defaultActive}
          links={Links}
        />
      </ResizablePanel>
    </>
  );
};

export default memo(SidePanel);
