import React, { useCallback } from 'react';
import { useSetRecoilState } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { MessageCirclePlus } from 'lucide-react';
import { TooltipAnchor, MobileSidebar, Sidebar, Button } from '@librechat/client';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache } from '~/utils';
import store from '~/store';

export default function NewChat({
  index = 0,
  toggleNav,
  subHeaders,
  isSmallScreen,
  headerButtons,
}: {
  index?: number;
  toggleNav: () => void;
  isSmallScreen?: boolean;
  subHeaders?: React.ReactNode;
  headerButtons?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  /** Note: this component needs an explicit index passed if using more than one */
  const { newConversation: newConvo } = useNewConvo(index);
  const navigate = useNavigate();
  const localize = useLocalize();
  const { conversation } = store.useCreateConversationAtom(index);
  const requestCloseRightSidePanel = useSetRecoilState(store.rightSidePanelCloseNonce);

  const clickHandler: React.MouseEventHandler<HTMLButtonElement> = useCallback(
    (e) => {
      requestCloseRightSidePanel((value) => value + 1);

      if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        window.open('/c/new', '_blank');
        return;
      }
      clearMessagesCache(queryClient, conversation?.conversationId);
      queryClient.invalidateQueries([QueryKeys.messages]);
      newConvo();
      navigate('/c/new', { state: { focusChat: true } });
      if (isSmallScreen) {
        toggleNav();
      }
    },
    [queryClient, conversation, newConvo, navigate, toggleNav, isSmallScreen, requestCloseRightSidePanel],
  );

  return (
    <>
      <div className="mb-2 flex items-center justify-between rounded-2xl border p-1.5 shadow-[0_16px_30px_-28px_var(--sidebar-shell-glow)] [border-color:var(--sidebar-shell-border)] [background:linear-gradient(150deg,var(--sidebar-shell-bg-alt)_0%,var(--sidebar-shell-bg)_100%)]">
        <TooltipAnchor
          description={localize('com_nav_close_sidebar')}
          render={
            <Button
              size="icon"
              variant="outline"
              data-testid="close-sidebar-button"
              aria-label={localize('com_nav_close_sidebar')}
              className="rounded-xl border p-2 transition-all duration-200 [background:var(--sidebar-search-bg)] [border-color:var(--sidebar-shell-border)] hover:[background:var(--sidebar-item-hover)] hover:[border-color:var(--sidebar-item-active-border)]"
              onClick={toggleNav}
            >
              <Sidebar className="icon-accent max-md:hidden" />
              <MobileSidebar className="icon-accent m-1 inline-flex size-10 items-center justify-center md:hidden" />
            </Button>
          }
        />
        <div className="flex items-center gap-1">{headerButtons}</div>
      </div>
      <Button
        variant="submit"
        data-testid="nav-new-chat-button"
        aria-label={localize('com_ui_new_conversation')}
        className="mb-2 w-full justify-center rounded-xl border p-2 font-medium transition-all duration-200 bg-surface-submit [border-color:var(--sidebar-shell-border)] hover:bg-surface-submit-hover focus:shadow-outline focus:brand-border"
        onClick={clickHandler}
      >
        <MessageCirclePlus className="h-4 w-4" />
        {localize('com_ui_new_conversation')}
      </Button>
      {subHeaders != null ? (
        <div className="mb-1 rounded-md border dark:border-gray-700 px-0.5 py-0.5 flex flex-col gap-1">
          {subHeaders}
        </div>
      ) : null}
    </>
  );
}
