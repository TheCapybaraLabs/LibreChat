import { useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { useRecoilValue } from 'recoil';
import { Button, ThemeSelector, useMediaQuery } from '@librechat/client';
import { useOutletContext } from 'react-router-dom';
import { CircleChevronRight, CircleEllipsis } from 'lucide-react';
import {
  Constants,
  getConfigDefaults,
  isAssistantsEndpoint,
  PermissionTypes,
  Permissions,
} from 'librechat-data-provider';
import type { ContextType } from '~/common';
import ModelSelector from './Menus/Endpoints/ModelSelector';
import { PresetsMenu, HeaderNewChat, OpenSidebar } from './Menus';
import { useGetStartupConfig } from '~/data-provider';
import ExportAndShareMenu from './ExportAndShareMenu';
import BookmarkMenu from './Menus/BookmarkMenu';
import { TemporaryChat } from './TemporaryChat';
import AddMultiConvo from './AddMultiConvo';
import { useHasAccess, useLocalize } from '~/hooks';
import { useRightSidePanel } from '~/Providers';
import { cn } from '~/utils';
import store from '~/store';
import { AnimatePresence, motion } from 'framer-motion';

const defaultInterface = getConfigDefaults().interface;

export default function Header() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const { isSidePanelOpen, toggleSidePanel } = useRightSidePanel();

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );

  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });

  const hasAccessToMultiConvo = useHasAccess({
    permissionType: PermissionTypes.MULTI_CONVO,
    permission: Permissions.USE,
  });

  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const mobileActionsStore = Ariakit.usePopoverStore({ placement: 'bottom-start' });
  const conversation = useRecoilValue(store.conversationByIndex(0)) || undefined;
  const conversationId = conversation?.conversationId ?? '';
  const isTemporary = conversation?.expiredAt != null;

  const canShowBookmarkAction =
    hasAccessToBookmarks === true &&
    !!conversation &&
    !!conversationId &&
    conversationId !== Constants.NEW_CONVO &&
    conversationId !== 'search' &&
    !isTemporary;

  const canShowAddMultiAction =
    hasAccessToMultiConvo === true &&
    !!conversation &&
    !isAssistantsEndpoint(conversation.endpoint);

  const canShowExportShareAction =
    !!conversation &&
    !!conversationId &&
    conversationId !== Constants.NEW_CONVO &&
    conversationId !== 'search';

  const shouldShowMobileActions =
    canShowBookmarkAction || canShowAddMultiAction || canShowExportShareAction;

  return (
    <div className="sticky top-0 z-10 mb-2 grid h-14 w-full grid-cols-[1fr_auto_1fr] items-center gap-2 overflow-hidden border-b border-border-light bg-gradient-to-r from-[#f7f1ff]/50 via-white to-[#f5ecff]/50 px-2 py-1 font-semibold text-text-primary shadow-[0_8px_24px_-20px_rgba(130,10,209,0.55)] backdrop-blur-sm dark:border-[#4a3b63] dark:bg-gradient-to-r dark:from-[#20182c]/50 dark:via-[#17171f]/50 dark:to-[#261d35]/50">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[#bc8cff] to-[#820ad1]" />

      <div className="relative z-10 flex min-w-0 items-center justify-start">
        <AnimatePresence initial={false}>
          {!navVisible && (
            <motion.div
              className="border-border-light/70 mr-2 flex items-center gap-2 border-r pr-2 max-md:hidden"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              key="header-buttons"
            >
              <OpenSidebar setNavVisible={setNavVisible} />
              <HeaderNewChat />
            </motion.div>
          )}
        </AnimatePresence>
        <div
          className={cn(
            'flex min-w-0 items-center gap-1 rounded-xl px-1 py-0.5 transition-all duration-200',
          )}
        >
          <TemporaryChat />
          {isSmallScreen && shouldShowMobileActions ? (
            <>
              <Ariakit.PopoverDisclosure
                store={mobileActionsStore}
                aria-label={localize('com_ui_more_options')}
                render={
                  <Button
                    variant="outline"
                    className="p-3"
                    data-testid="header-mobile-actions-button"
                  />
                }
              >
                <CircleEllipsis className="h-4 w-4" />
              </Ariakit.PopoverDisclosure>
              <Ariakit.Popover
                store={mobileActionsStore}
                portal={true}
                gutter={10}
                unmountOnHide={true}
                className="z-50 rounded-xl border border-border-light bg-surface-primary p-1.5 shadow-lg"
              >
                <div className="flex items-center gap-1">
                  {canShowBookmarkAction && <BookmarkMenu />}
                  {canShowAddMultiAction && <AddMultiConvo />}
                  <ExportAndShareMenu
                    isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
                  />
                </div>
              </Ariakit.Popover>
            </>
          ) : (
            <>
              {hasAccessToBookmarks === true && <BookmarkMenu />}
              {hasAccessToMultiConvo === true && <AddMultiConvo />}
              <ExportAndShareMenu
                isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
              />
            </>
          )}
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 items-center justify-center">
        <ModelSelector startupConfig={startupConfig} />
      </div>

      <div className="hide-scrollbar relative z-10 flex min-w-0 items-center justify-end gap-2 overflow-x-auto">
        {!isSmallScreen && interfaceConfig.presets === true && interfaceConfig.modelSelect && (
          <PresetsMenu />
        )}

        {!isSmallScreen && (
          <div
            className={cn(
              'rounded-xl border border-border-light',
              '[&>button]:inline-flex [&>button]:h-10 [&>button]:w-10 [&>button]:items-center [&>button]:justify-center [&>button]:gap-0 [&>button]:p-0 [&>button]:leading-none',
              '[&>button>svg]:block [&>button>svg]:h-4 [&>button>svg]:w-4 [&>button>svg]:shrink-0',
            )}
          >
            <ThemeSelector returnThemeOnly={true} />
          </div>
        )}

        {interfaceConfig.sidePanel === true && (
          <Button
            variant="outline"
            onClick={toggleSidePanel}
            aria-label={localize('com_ui_more_options')}
            aria-expanded={isSidePanelOpen}
            aria-controls="controls-nav"
            className={cn(
              'p-3',
              isSidePanelOpen ? 'bg-surface-active' : 'bg-transparent hover:bg-surface-hover',
            )}
          >
            {!isSmallScreen && localize('com_ui_more_options')}
            <CircleChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
