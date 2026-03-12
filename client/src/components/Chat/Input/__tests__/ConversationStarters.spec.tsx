import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConversationStarters from '../ConversationStarters';

jest.mock('~/Providers', () => ({
  useChatContext: jest.fn(),
  useAgentsMapContext: jest.fn(),
  useAssistantsMapContext: jest.fn(),
}));

jest.mock('~/data-provider', () => ({
  useGetAssistantDocsQuery: jest.fn(),
  useGetEndpointsQuery: jest.fn(),
  useGetStartupConfig: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: jest.fn(),
  useSelectAgent: jest.fn(),
  useSubmitMessage: jest.fn(),
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  getIconEndpoint: jest.fn(),
  getEntity: jest.fn(),
}));

const mockUseChatContext = jest.requireMock('~/Providers').useChatContext;
const mockUseAgentsMapContext = jest.requireMock('~/Providers').useAgentsMapContext;
const mockUseAssistantsMapContext = jest.requireMock('~/Providers').useAssistantsMapContext;

const mockUseGetAssistantDocsQuery = jest.requireMock('~/data-provider').useGetAssistantDocsQuery;
const mockUseGetEndpointsQuery = jest.requireMock('~/data-provider').useGetEndpointsQuery;
const mockUseGetStartupConfig = jest.requireMock('~/data-provider').useGetStartupConfig;

const mockUseLocalize = jest.requireMock('~/hooks').useLocalize;
const mockUseSelectAgent = jest.requireMock('~/hooks').useSelectAgent;
const mockUseSubmitMessage = jest.requireMock('~/hooks').useSubmitMessage;

const mockGetIconEndpoint = jest.requireMock('~/utils').getIconEndpoint;
const mockGetEntity = jest.requireMock('~/utils').getEntity;

describe('ConversationStarters', () => {
  const mockSubmitMessage = jest.fn();
  const mockSelectAgent = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseChatContext.mockReturnValue({
      conversation: {
        endpoint: 'openAI',
      },
    });

    mockUseAgentsMapContext.mockReturnValue({});
    mockUseAssistantsMapContext.mockReturnValue({});

    mockUseGetEndpointsQuery.mockReturnValue({ data: {} });
    mockUseGetAssistantDocsQuery.mockReturnValue({ data: new Map() });
    mockUseGetStartupConfig.mockReturnValue({ data: { interface: {} } });

    mockUseLocalize.mockReturnValue((key: string) => {
      const translations: Record<string, string> = {
        com_ui_starter_summarize_document: 'Resumir Documento',
        com_ui_starter_create_email: 'Criar E-mail',
        com_ui_starter_project_ideas: 'Ideias de Projeto',
        com_ui_agent: 'Agente',
      };
      return translations[key] || key;
    });

    mockUseSubmitMessage.mockReturnValue({ submitMessage: mockSubmitMessage });
    mockUseSelectAgent.mockReturnValue({ onSelect: mockSelectAgent });

    mockGetIconEndpoint.mockReturnValue('openAI');
    mockGetEntity.mockReturnValue({
      entity: null,
      isAgent: false,
    });
  });

  it('renders default cards and keeps project ideas behavior when shortcut config is absent', () => {
    render(<ConversationStarters />);

    expect(screen.getByText('Resumir Documento')).toBeInTheDocument();
    expect(screen.getByText('Criar E-mail')).toBeInTheDocument();
    expect(screen.getByText('Ideias de Projeto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ideias de Projeto' }));

    expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'Ideias de Projeto' });
    expect(mockSelectAgent).not.toHaveBeenCalled();
  });

  it('replaces project ideas with configured agent shortcut and selects agent on click', () => {
    mockUseGetStartupConfig.mockReturnValue({
      data: { interface: { newChatAgentShortcut: { agentId: 'agent-1' } } },
    });
    mockUseAgentsMapContext.mockReturnValue({
      'agent-1': { id: 'agent-1', name: 'Agente Financeiro' },
    });

    render(<ConversationStarters />);

    const agentButton = screen.getByRole('button', { name: 'Agente Financeiro' });
    fireEvent.click(agentButton);

    expect(mockSelectAgent).toHaveBeenCalledWith('agent-1');
    expect(mockSubmitMessage).not.toHaveBeenCalledWith({ text: 'Ideias de Projeto' });
  });

  it('renders a disabled agent shortcut card when configured agent is unavailable', () => {
    mockUseGetStartupConfig.mockReturnValue({
      data: { interface: { newChatAgentShortcut: { agentId: 'missing-agent' } } },
    });
    mockUseAgentsMapContext.mockReturnValue({});

    render(<ConversationStarters />);

    const button = screen.getByRole('button', { name: 'Agente' });
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(mockSelectAgent).not.toHaveBeenCalled();
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  it('prioritizes entity conversation starters when available', () => {
    mockGetEntity.mockReturnValue({
      entity: { conversation_starters: ['Starter A', 'Starter B'] },
      isAgent: false,
    });

    render(<ConversationStarters />);

    expect(screen.getByText('Starter A')).toBeInTheDocument();
    expect(screen.getByText('Starter B')).toBeInTheDocument();
    expect(screen.queryByText('Ideias de Projeto')).not.toBeInTheDocument();
  });

  it('does not render starter cards when an agent is selected', () => {
    mockUseChatContext.mockReturnValue({
      conversation: {
        endpoint: 'agents',
        agent_id: 'agent-1',
      },
    });
    mockGetEntity.mockReturnValue({
      entity: { conversation_starters: ['Starter A'] },
      isAgent: true,
    });

    const { container } = render(<ConversationStarters />);

    expect(container).toBeEmptyDOMElement();
  });
});
