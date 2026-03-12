import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import { useOutletContext } from 'react-router-dom';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { Gem } from 'lucide-react';
import { useMediaQuery } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type t from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useDocumentTitle, useHasAccess, useLocalize, TranslationKeys } from '~/hooks';
import { useGetEndpointsQuery, useGetAgentCategoriesQuery } from '~/data-provider';
import MarketplaceAdminSettings from './MarketplaceAdminSettings';
import Presentation from '~/components/Chat/Presentation';
import { HeaderNewChat, OpenSidebar } from '~/components/Chat/Menus';
import { cn } from '~/utils';
import CategoryTabs from './CategoryTabs';
import AgentDetail from './AgentDetail';
import SearchBar from './SearchBar';
import AgentGrid from './AgentGrid';
import store from '~/store';

interface AgentMarketplaceProps {
  className?: string;
}

/**
 * AgentMarketplace - Main component for browsing and discovering agents
 *
 * Provides tabbed navigation for different agent categories,
 * search functionality, and detailed agent view through a modal dialog.
 * Uses URL parameters for state persistence and deep linking.
 */
const AgentMarketplace: React.FC<AgentMarketplaceProps> = ({ className = '' }) => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { category } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const [hideSidePanel, setHideSidePanel] = useRecoilState(store.hideSidePanel);

  // Get URL parameters
  const searchQuery = searchParams.get('q') || '';
  const selectedAgentId = searchParams.get('agent_id') || '';

  // Animation state
  type Direction = 'left' | 'right';
  // Initialize with a default value to prevent rendering issues
  const [displayCategory, setDisplayCategory] = useState<string>(category || 'all');
  const [nextCategory, setNextCategory] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [animationDirection, setAnimationDirection] = useState<Direction>('right');

  // Ref for the scrollable container to enable infinite scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Local state
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<t.Agent | null>(null);

  // Set page title
  useDocumentTitle(`${localize('com_agents_marketplace')} | LibreChat`);

  // Keep the side panel feature enabled in marketplace without forcing it open.
  useEffect(() => {
    if (!hideSidePanel) {
      return;
    }

    setHideSidePanel(false);
    localStorage.setItem('hideSidePanel', 'false');
  }, [setHideSidePanel, hideSidePanel]);

  // Ensure endpoints config is loaded first (required for agent queries)
  useGetEndpointsQuery();

  // Fetch categories using existing query pattern
  const categoriesQuery = useGetAgentCategoriesQuery({
    staleTime: 1000 * 60 * 15, // 15 minutes - categories rarely change
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  // Handle initial category when on /agents without a category
  useEffect(() => {
    if (
      !category &&
      window.location.pathname === '/agents' &&
      categoriesQuery.data &&
      displayCategory === 'all'
    ) {
      const hasPromoted = categoriesQuery.data.some((cat) => cat.value === 'promoted');
      if (hasPromoted) {
        // If promoted exists, update display to show it
        setDisplayCategory('promoted');
      }
    }
  }, [category, categoriesQuery.data, displayCategory]);

  /**
   * Handle agent card selection
   *
   * @param agent - The selected agent object
   */
  const handleAgentSelect = (agent: t.Agent) => {
    // Update URL with selected agent
    const newParams = new URLSearchParams(searchParams);
    newParams.set('agent_id', agent.id);
    setSearchParams(newParams);
    setSelectedAgent(agent);
    setIsDetailOpen(true);
  };

  /**
   * Handle closing the agent detail dialog
   */
  const handleDetailClose = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('agent_id');
    setSearchParams(newParams);
    setSelectedAgent(null);
    setIsDetailOpen(false);
  };

  /**
   * Determine ordered tabs to compute indices for direction
   */
  const orderedTabs = useMemo<string[]>(() => {
    const dynamic = (categoriesQuery.data || []).map((c) => c.value);
    // Only include values that actually exist in the categories
    const set = new Set<string>(dynamic);
    return Array.from(set);
  }, [categoriesQuery.data]);

  const getTabIndex = useCallback(
    (tab: string): number => {
      const idx = orderedTabs.indexOf(tab);
      return idx >= 0 ? idx : 0;
    },
    [orderedTabs],
  );

  const getCategoryData = useCallback(
    (categoryValue: string | null | undefined) => {
      if (!categoryValue || categoryValue === 'promoted') {
        return {
          name: localize('com_agents_top_picks'),
          description: localize('com_agents_recommended'),
        };
      }

      if (categoryValue === 'all') {
        return {
          name: localize('com_agents_all'),
          description: localize('com_agents_all_description'),
        };
      }

      const categoryData = categoriesQuery.data?.find((cat) => cat.value === categoryValue);
      if (categoryData) {
        return {
          name: categoryData.label?.startsWith('com_')
            ? localize(categoryData.label as TranslationKeys)
            : categoryData.label,
          description: categoryData.description?.startsWith('com_')
            ? localize(categoryData.description as TranslationKeys)
            : categoryData.description || '',
        };
      }

      return {
        name: categoryValue.charAt(0).toUpperCase() + categoryValue.slice(1),
        description: '',
      };
    },
    [categoriesQuery.data, localize],
  );

  const currentCategoryData = useMemo(
    () => getCategoryData(displayCategory),
    [displayCategory, getCategoryData],
  );
  const nextCategoryData = useMemo(
    () => getCategoryData(nextCategory),
    [getCategoryData, nextCategory],
  );

  /**
   * Handle category tab selection changes with directional animation
   */
  const handleTabChange = (tabValue: string) => {
    if (tabValue === displayCategory || isTransitioning) {
      // Ignore redundant or rapid clicks during transition
      return;
    }

    const currentIndex = getTabIndex(displayCategory);
    const newIndex = getTabIndex(tabValue);
    const direction: Direction = newIndex > currentIndex ? 'right' : 'left';

    setAnimationDirection(direction);
    setNextCategory(tabValue);
    setIsTransitioning(true);

    // Update URL immediately, preserving current search params
    const currentSearchParams = searchParams.toString();
    const searchParamsStr = currentSearchParams ? `?${currentSearchParams}` : '';
    if (tabValue === 'promoted') {
      navigate(`/agents${searchParamsStr}`);
    } else {
      navigate(`/agents/${tabValue}${searchParamsStr}`);
    }

    // Complete transition after 300ms
    window.setTimeout(() => {
      setDisplayCategory(tabValue);
      setNextCategory(null);
      setIsTransitioning(false);
    }, 300);
  };

  /**
   * Sync display when URL changes externally (back/forward)
   */
  useEffect(() => {
    if (category && category !== displayCategory && !isTransitioning) {
      // URL changed externally, update display without animation
      setDisplayCategory(category);
    }
  }, [category, displayCategory, isTransitioning]);

  // No longer needed with keyframes

  /**
   * Handle search query changes
   *
   * @param query - The search query string
   */
  const handleSearch = (query: string) => {
    const newParams = new URLSearchParams(searchParams);
    const currentCategory = displayCategory;

    if (query.trim()) {
      newParams.set('q', query.trim());
    } else {
      newParams.delete('q');
    }

    // Always preserve current category when searching or clearing search
    if (currentCategory === 'promoted') {
      navigate(`/agents${newParams.toString() ? `?${newParams.toString()}` : ''}`);
    } else {
      navigate(
        `/agents/${currentCategory}${newParams.toString() ? `?${newParams.toString()}` : ''}`,
      );
    }
  };

  // Check if a detail view should be open based on URL
  useEffect(() => {
    setIsDetailOpen(!!selectedAgentId);
  }, [selectedAgentId]);

  const hasAccessToMarketplace = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    if (!hasAccessToMarketplace) {
      timeoutId = setTimeout(() => {
        navigate('/c/new');
      }, 1000);
    }
    return () => {
      clearTimeout(timeoutId);
    };
  }, [hasAccessToMarketplace, navigate]);

  if (!hasAccessToMarketplace) {
    return null;
  }

  return (
    <Presentation>
      <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>
        {!isSmallScreen && (
          <div className="relative z-30 isolate grid h-14 w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden border-b border-border-light bg-gradient-to-r from-[#f7f1ff] via-white to-[#f5ecff] px-2 py-1 font-semibold text-text-primary shadow-[0_8px_24px_-20px_rgba(130,10,209,0.55)] dark:border-[#4a3b63] dark:bg-gradient-to-r dark:from-[#20182c] dark:via-[#17171f] dark:to-[#261d35]">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[#bc8cff] to-[#820ad1]" />
            <div className="relative z-10 flex min-w-0 items-center gap-2">
              {!navVisible && (
                <>
                  <OpenSidebar setNavVisible={setNavVisible} />
                  <HeaderNewChat />
                </>
              )}
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border-light bg-surface-primary/70 px-3 py-2 text-sm shadow-sm">
                <Gem className="h-4 w-4 shrink-0 text-text-primary" />
                <span className="truncate">{localize('com_agents_marketplace')}</span>
              </div>
            </div>

            <div className="relative z-10 hidden min-w-0 items-center justify-center lg:flex">
              <div className="truncate text-sm font-medium text-text-secondary">
                {searchQuery ? searchQuery : currentCategoryData.name}
              </div>
            </div>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          className="scrollbar-gutter-stable relative flex flex-1 min-h-0 flex-col overflow-y-auto overflow-x-hidden"
        >

          {!isSmallScreen && (
            <div className="mx-auto w-full max-w-4xl px-4">
              <div className="mb-8 mt-12 text-center">
                <h1 className="mb-3 text-3xl font-bold tracking-tight text-text-primary md:text-5xl">
                  {localize('com_agents_marketplace')}
                </h1>
                <p className="mx-auto mb-6 max-w-2xl text-lg text-text-secondary">
                  {localize('com_agents_marketplace_subtitle')}
                </p>
              </div>
            </div>
          )}

          <div
            className={cn(
              'sticky z-20 border-b border-transparent bg-surface-primary pb-4 rounded-bl-xl rounded-br-xl backdrop-blur-sm backdrop-saturate-150',
              'top-0',
            )}
          >
            <div className="mx-auto w-full max-w-4xl px-4">
              <div className="mx-auto flex max-w-2xl gap-2 p-4">
                <SearchBar value={searchQuery} onSearch={handleSearch} />
              </div>

              <CategoryTabs
                categories={categoriesQuery.data || []}
                activeTab={displayCategory}
                isLoading={categoriesQuery.isLoading}
                onChange={handleTabChange}
              />
            </div>
          </div>

          <div className="mx-auto w-full max-w-4xl px-4 pb-8">
            <div className="relative overflow-hidden">
              <div
                className={cn(
                  isTransitioning &&
                    (animationDirection === 'right'
                      ? 'motion-safe:animate-slide-out-left'
                      : 'motion-safe:animate-slide-out-right'),
                )}
                key={`pane-current-${displayCategory}`}
              >
                {!searchQuery && (
                  <div className="mb-6 mt-6 text-left">
                    <h2 className="text-2xl font-bold text-text-primary">
                      {currentCategoryData.name}
                    </h2>
                    {currentCategoryData.description && (
                      <p className="mt-2 text-text-secondary">{currentCategoryData.description}</p>
                    )}
                  </div>
                )}

                <AgentGrid
                  key={`grid-${displayCategory}`}
                  category={displayCategory}
                  searchQuery={searchQuery}
                  onSelectAgent={handleAgentSelect}
                  scrollElementRef={scrollContainerRef}
                />
              </div>

              {isTransitioning && nextCategory && (
                <div
                  className={cn(
                    'absolute inset-0',
                    animationDirection === 'right'
                      ? 'motion-safe:animate-slide-in-right'
                      : 'motion-safe:animate-slide-in-left',
                  )}
                  key={`pane-next-${nextCategory}-${animationDirection}`}
                >
                  {!searchQuery && (
                    <div className="mb-6 mt-6 text-left">
                      <h2 className="text-2xl font-bold text-text-primary">
                        {nextCategoryData.name}
                      </h2>
                      {nextCategoryData.description && (
                        <p className="mt-2 text-text-secondary">{nextCategoryData.description}</p>
                      )}
                    </div>
                  )}

                  <AgentGrid
                    key={`grid-${nextCategory}`}
                    category={nextCategory}
                    searchQuery={searchQuery}
                    onSelectAgent={handleAgentSelect}
                    scrollElementRef={scrollContainerRef}
                  />
                </div>
              )}
            </div>

            {isDetailOpen && selectedAgent && (
              <AgentDetail agent={selectedAgent} isOpen={isDetailOpen} onClose={handleDetailClose} />
            )}
          </div>
        </div>
      </div>
    </Presentation>
  );
};

export default AgentMarketplace;
