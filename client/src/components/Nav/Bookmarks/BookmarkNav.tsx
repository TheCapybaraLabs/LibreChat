import { useMemo } from 'react';
import type { FC } from 'react';
import { Button, TooltipAnchor } from '@librechat/client';
import { Menu, MenuButton, MenuItems } from '@headlessui/react';
import { Star } from 'lucide-react';
import { BookmarkContext } from '~/Providers/BookmarkContext';
import { useGetConversationTags } from '~/data-provider';
import BookmarkNavItems from './BookmarkNavItems';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type BookmarkNavProps = {
  tags: string[];
  setTags: (tags: string[]) => void;
  isSmallScreen: boolean;
};

const BookmarkNav: FC<BookmarkNavProps> = ({ tags, setTags }: BookmarkNavProps) => {
  const localize = useLocalize();
  const { data } = useGetConversationTags();
  const hasActiveFilters = tags.length > 0;
  const label = useMemo(
    () => (tags.length > 0 ? tags.join(', ') : localize('com_ui_bookmarks')),
    [tags, localize],
  );

  return (
    <Menu as="div" className="group relative">
      <TooltipAnchor
        description={label}
        render={
          <MenuButton
            as={Button}
            id="bookmark-menu-button"
            size="default"
            variant="outline"
            data-testid="bookmark-menu"
            aria-label={localize('com_ui_bookmarks')}
            className={cn(
              'w-full rounded-xl border p-3 transition-all duration-200',
              'border-border-light bg-surface-secondary hover:bg-surface-hover',
              hasActiveFilters
                ? '[border-color:var(--sidebar-item-active-border)] [background:var(--sidebar-item-hover)]'
                : '',
            )}
          >
            <Star
              className={cn(
                'icon-md text-text-primary',
                hasActiveFilters ? 'fill-current text-[var(--sidebar-item-active-border)]' : '',
              )}
              aria-hidden="true"
            />
            {localize('com_ui_bookmarks')}
          </MenuButton>
        }
      />
      <MenuItems
        anchor="bottom"
        className="absolute left-0 top-full z-[100] mt-1 w-60 translate-y-0 overflow-hidden rounded-lg bg-surface-secondary p-1.5 shadow-lg outline-none"
      >
        {data && (
          <BookmarkContext.Provider value={{ bookmarks: data.filter((tag) => tag.count > 0) }}>
            <BookmarkNavItems
              // List of selected tags(string)
              tags={tags}
              // When a user selects a tag, this `setTags` function is called to refetch the list of conversations for the selected tag
              setTags={setTags}
            />
          </BookmarkContext.Provider>
        )}
      </MenuItems>
    </Menu>
  );
};

export default BookmarkNav;
