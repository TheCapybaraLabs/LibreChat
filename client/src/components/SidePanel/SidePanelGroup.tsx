import { useState, useCallback, useEffect, useMemo, memo, useRef } from 'react';
import { createPortal } from 'react-dom';
import throttle from 'lodash/throttle';
import { useRecoilValue } from 'recoil';
import { getConfigDefaults } from 'librechat-data-provider';
import { ResizablePanel, ResizablePanelGroup, useMediaQuery } from '@librechat/client';
import { useGetStartupConfig } from '~/data-provider';
import { RightSidePanelProvider } from '~/Providers';
import ArtifactsPanel from './ArtifactsPanel';
import { normalizeLayout } from '~/utils';
import SidePanel from './SidePanel';
import store from '~/store';
import { cn } from '~/utils';

interface SidePanelProps {
  defaultLayout?: number[] | undefined;
  defaultCollapsed?: boolean;
  fullPanelCollapse?: boolean;
  artifacts?: React.ReactNode;
  children: React.ReactNode;
}

const defaultInterface = getConfigDefaults().interface;

const SidePanelGroup = memo(
  ({
    defaultLayout = [97, 3],
    defaultCollapsed = false,
    fullPanelCollapse = false,
    artifacts,
    children,
  }: SidePanelProps) => {
    const { data: startupConfig } = useGetStartupConfig();
    const interfaceConfig = useMemo(
      () => startupConfig?.interface ?? defaultInterface,
      [startupConfig],
    );

    const startsCollapsed = defaultCollapsed || fullPanelCollapse;
    const [fullCollapse, setFullCollapse] = useState(startsCollapsed);
    const [shouldRenderArtifacts, setShouldRenderArtifacts] = useState(artifacts != null);

    const isSmallScreen = useMediaQuery('(max-width: 767px)');
    const hideSidePanel = useRecoilValue(store.hideSidePanel);
    const rightSidePanelCloseNonce = useRecoilValue(store.rightSidePanelCloseNonce);
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    const hasHandledInitialCloseRequest = useRef(false);

    const calculateLayout = useCallback(() => {
      if (artifacts == null) {
        return [100];
      } else {
        const mainSize = defaultLayout[0] ?? 50;
        const artifactsSize = defaultLayout[1] ?? 50;
        const hasLegacySidePanelLayout = defaultLayout.length > 2 || artifactsSize < 10;
        if (hasLegacySidePanelLayout) {
          return [50, 50];
        }
        return [mainSize, artifactsSize];
      }
    }, [artifacts, defaultLayout]);

    const currentLayout = useMemo(() => normalizeLayout(calculateLayout()), [calculateLayout]);

    const throttledSaveLayout = useMemo(
      () =>
        throttle((sizes: number[]) => {
          const normalizedSizes = normalizeLayout(sizes);
          localStorage.setItem('react-resizable-panels:layout', JSON.stringify(normalizedSizes));
        }, 350),
      [],
    );

    const closeSidePanel = useCallback(() => {
      setFullCollapse(true);
      localStorage.setItem('fullPanelCollapse', 'true');
      localStorage.setItem('react-resizable-panels:collapsed', 'true');
    }, []);

    const openSidePanel = useCallback(() => {
      setFullCollapse(false);
      localStorage.setItem('fullPanelCollapse', 'false');
      localStorage.setItem('react-resizable-panels:collapsed', 'false');
    }, []);

    const toggleSidePanel = useCallback(() => {
      if (fullCollapse) {
        openSidePanel();
        return;
      }
      closeSidePanel();
    }, [closeSidePanel, fullCollapse, openSidePanel]);

    useEffect(() => {
      if (defaultCollapsed || fullPanelCollapse) {
        closeSidePanel();
        return;
      }

      openSidePanel();
    }, [defaultCollapsed, fullPanelCollapse, closeSidePanel, openSidePanel]);

    useEffect(() => {
      setPortalTarget(document.body);
    }, []);

    useEffect(() => {
      if (!hasHandledInitialCloseRequest.current) {
        hasHandledInitialCloseRequest.current = true;
        return;
      }

      closeSidePanel();
    }, [closeSidePanel, rightSidePanelCloseNonce]);

    const minSizeMain = useMemo(() => (artifacts != null ? 15 : 30), [artifacts]);

    const isSidePanelOpen = !hideSidePanel && interfaceConfig.sidePanel === true && !fullCollapse;
    const rightSidePanelContextValue = useMemo(
      () => ({
        isSidePanelOpen,
        openSidePanel,
        closeSidePanel,
        toggleSidePanel,
      }),
      [closeSidePanel, isSidePanelOpen, openSidePanel, toggleSidePanel],
    );

    return (
      <RightSidePanelProvider value={rightSidePanelContextValue}>
        <div className="relative h-full w-full flex-1 overflow-hidden bg-presentation">
          <ResizablePanelGroup
            direction="horizontal"
            onLayout={(sizes) => throttledSaveLayout(sizes)}
            className="relative h-full w-full flex-1 overflow-auto bg-presentation"
          >
            <ResizablePanel
              defaultSize={currentLayout[0]}
              minSize={minSizeMain}
              order={1}
              id="messages-view"
            >
              {children}
            </ResizablePanel>

            {!isSmallScreen && (
              <ArtifactsPanel
                artifacts={artifacts}
                currentLayout={currentLayout}
                minSizeMain={minSizeMain}
                shouldRender={shouldRenderArtifacts}
                onRenderChange={setShouldRenderArtifacts}
              />
            )}
          </ResizablePanelGroup>
          {!hideSidePanel && interfaceConfig.sidePanel === true && (
            <button
              type="button"
              aria-label="Close right side panel"
              className={cn(
                'absolute inset-0 z-[60] bg-[radial-gradient(circle_at_20%_15%,rgba(159,61,216,0.2),transparent_48%),var(--sidebar-mask-bg,rgba(39,18,66,0.38))] backdrop-blur-[4px] transition-opacity duration-200',
                isSidePanelOpen
                  ? 'pointer-events-auto opacity-100'
                  : 'pointer-events-none opacity-0',
              )}
              onClick={closeSidePanel}
            />
          )}
        </div>
        {!hideSidePanel &&
          interfaceConfig.sidePanel === true &&
          (portalTarget != null
            ? createPortal(
                <SidePanel
                  fullCollapse={fullCollapse}
                  closeSidePanel={closeSidePanel}
                  interfaceConfig={interfaceConfig}
                />,
                portalTarget,
              )
            : null)}
        {artifacts != null && isSmallScreen && (
          <div className="fixed inset-0 z-[100]">{artifacts}</div>
        )}
      </RightSidePanelProvider>
    );
  },
);

SidePanelGroup.displayName = 'SidePanelGroup';

export default SidePanelGroup;
