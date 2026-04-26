import { QueryKeys } from 'librechat-data-provider';
import { useRecoilValue } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import { Button, NewChatIcon } from '@librechat/client';
import { useNewConvo, useLocalize } from '~/hooks';
import { clearMessagesCache } from '~/utils';
import store from '~/store';

export default function HeaderNewChat() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const conversation = useRecoilValue(store.conversationByIndex(0));

  const clickHandler: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      window.open('/c/new', '_blank');
      return;
    }
    clearMessagesCache(queryClient, conversation?.conversationId);
    queryClient.invalidateQueries([QueryKeys.messages]);
    newConversation();
  };

  return (
    <Button
      variant="outline"
      data-testid="wide-header-new-chat-button"
      aria-label={localize('com_ui_new_chat')}
      className="flex items-center gap-2 rounded-xl bg-presentation px-3 duration-0 hover:bg-surface-active-alt max-md:hidden"
      onClick={clickHandler}
    >
      <NewChatIcon className="shrink-0" />
      {localize('com_ui_new_chat')}
    </Button>
  );
}
