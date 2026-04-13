import * as React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { ButtonProps, buttonVariants } from './Button';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => {
  const localize = useLocalize();
  return (
    <nav
      aria-label={localize('com_ui_pagination')}
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  );
};
Pagination.displayName = 'Pagination';

const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-row items-center gap-1', className)} {...props} />
  ),
);
PaginationContent.displayName = 'PaginationContent';

const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn('', className)} {...props} />,
);
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<ButtonProps, 'size'> &
  React.ComponentProps<'a'>;

const PaginationLink = ({
  className,
  isActive = false,
  size = 'icon',
  children,
  ...props
}: PaginationLinkProps) => {
  const localize = useLocalize();
  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        buttonVariants({
          variant: isActive ? 'outline' : 'ghost',
          size,
        }),
        className,
      )}
      {...props}
    >
      {children || <span className="sr-only">{localize('com_ui_page_link')}</span>}
    </a>
  );
};
PaginationLink.displayName = 'PaginationLink';

const PaginationPrevious = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => {
  const localize = useLocalize();
  return (
    <PaginationLink
      aria-label={localize('com_ui_previous_page')}
      size="default"
      className={cn('gap-1 pl-2.5', className)}
      {...props}
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      <span>{localize('com_ui_prev')}</span>
    </PaginationLink>
  );
};
PaginationPrevious.displayName = 'PaginationPrevious';

const PaginationNext = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>) => {
  const localize = useLocalize();
  return (
    <PaginationLink
      aria-label={localize('com_ui_next_page')}
      size="default"
      className={cn('gap-1 pr-2.5', className)}
      {...props}
    >
      <span>{localize('com_ui_next')}</span>
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </PaginationLink>
  );
};
PaginationNext.displayName = 'PaginationNext';

const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<'span'>) => {
  const localize = useLocalize();
  return (
    <span
      aria-hidden
      className={cn('flex h-9 w-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{localize('com_ui_pagination_more_pages')}</span>
    </span>
  );
};
PaginationEllipsis.displayName = 'PaginationEllipsis';

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
