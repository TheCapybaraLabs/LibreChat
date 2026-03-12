import { useMemo, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bot, FileText, Mail, Lightbulb, MessageSquarePlus } from 'lucide-react';
import { EModelEndpoint, Constants } from 'librechat-data-provider';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import {
  useGetAssistantDocsQuery,
  useGetEndpointsQuery,
  useGetStartupConfig,
} from '~/data-provider';
import { cn, getIconEndpoint, getEntity } from '~/utils';
import { useLocalize, useSelectAgent, useSubmitMessage } from '~/hooks';

type StarterCard = {
  label: string;
  prompt?: string;
  onClick?: () => void;
  disabled?: boolean;
  Icon: LucideIcon;
};

const ConversationStarters = () => {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const localize = useLocalize();
  const { onSelect: selectAgent } = useSelectAgent();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();

  const endpointType = useMemo(() => {
    let ep = conversation?.endpoint ?? '';
    if (
      [
        EModelEndpoint.chatGPTBrowser,
        EModelEndpoint.azureOpenAI,
        EModelEndpoint.gptPlugins,
      ].includes(ep as EModelEndpoint)
    ) {
      ep = EModelEndpoint.openAI;
    }
    return getIconEndpoint({
      endpointsConfig,
      iconURL: conversation?.iconURL,
      endpoint: ep,
    });
  }, [conversation?.endpoint, conversation?.iconURL, endpointsConfig]);

  const { data: documentsMap = new Map() } = useGetAssistantDocsQuery(endpointType, {
    select: (data) => new Map(data.map((dbA) => [dbA.assistant_id, dbA])),
  });

  const { entity, isAgent } = getEntity({
    endpoint: endpointType,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });

  const conversation_starters = useMemo(() => {
    if (entity?.conversation_starters?.length) {
      return entity.conversation_starters;
    }

    if (isAgent) {
      return [];
    }

    return documentsMap.get(entity?.id ?? '')?.conversation_starters ?? [];
  }, [documentsMap, isAgent, entity]);

  const hasSelectedAgent = Boolean(conversation?.agent_id);

  const { submitMessage } = useSubmitMessage();
  const sendConversationStarter = useCallback(
    (text: string) => submitMessage({ text }),
    [submitMessage],
  );

  const shortcutConfig = startupConfig?.interface as
    | { newChatAgentShortcut?: { agentId?: string } }
    | undefined;
  const shortcutAgentId = shortcutConfig?.newChatAgentShortcut?.agentId?.trim() ?? '';
  const shortcutAgent = shortcutAgentId ? agentsMap?.[shortcutAgentId] : undefined;

  const defaultStarters = useMemo<StarterCard[]>(
    () => [
      {
        label: localize('com_ui_starter_summarize_document'),
        prompt: localize('com_ui_starter_summarize_document'),
        Icon: FileText,
      },
      {
        label: localize('com_ui_starter_create_email'),
        prompt: localize('com_ui_starter_create_email'),
        Icon: Mail,
      },
      shortcutAgentId
        ? {
            label: shortcutAgent?.name || localize('com_ui_agent'),
            Icon: Bot,
            disabled: !shortcutAgent,
            onClick: shortcutAgent ? () => void selectAgent(shortcutAgent.id) : undefined,
          }
        : {
            label: localize('com_ui_starter_project_ideas'),
            prompt: localize('com_ui_starter_project_ideas'),
            Icon: Lightbulb,
          },
    ],
    [localize, selectAgent, shortcutAgent, shortcutAgentId],
  );

  const starterCards = useMemo<StarterCard[]>(() => {
    if (conversation_starters.length > 0) {
      return conversation_starters.slice(0, Constants.MAX_CONVO_STARTERS).map((text) => ({
        label: text,
        prompt: text,
        Icon: MessageSquarePlus,
      }));
    }

    return defaultStarters;
  }, [conversation_starters, defaultStarters]);

  const handleStarterClick = useCallback(
    ({ prompt, onClick, disabled }: StarterCard) => {
      if (disabled) {
        return;
      }
      if (onClick) {
        onClick();
        return;
      }
      if (prompt) {
        sendConversationStarter(prompt);
      }
    },
    [sendConversationStarter],
  );

  if (hasSelectedAgent || !starterCards.length) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap justify-center gap-2 px-3 sm:mt-2 sm:gap-4 sm:px-4">
      {starterCards.map((card, index) => (
        <button
          key={`${card.label}-${index}`}
          disabled={card.disabled}
          aria-disabled={card.disabled}
          onClick={() => handleStarterClick(card)}
          className={cn(
            'relative flex min-h-[82px] w-[108px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border-medium px-2.5 py-2 text-center shadow-[0_0_2px_0_rgba(0,0,0,0.05),0_8px_18px_-14px_rgba(0,0,0,0.25)] transition-colors duration-200 ease-in-out fade-in sm:min-h-[112px] sm:w-[210px] sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-4',
            card.disabled
              ? 'cursor-not-allowed opacity-60'
              : 'cursor-pointer hover:bg-surface-tertiary',
          )}
        >
          <card.Icon className="h-4 w-4 text-text-primary sm:h-6 sm:w-6" />
          <p className="line-clamp-2 text-xs font-medium text-text-primary sm:text-base">
            {card.label}
          </p>
        </button>
      ))}
    </div>
  );
};

export default ConversationStarters;
