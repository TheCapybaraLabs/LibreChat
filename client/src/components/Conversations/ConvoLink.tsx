import React from 'react';
import { cn } from '~/utils';

interface ConvoLinkProps {
  isActiveConvo: boolean;
  title: string | null;
  onRename: () => void;
  isSmallScreen: boolean;
  localize: (key: any, options?: any) => string;
  children: React.ReactNode;
}

const ConvoLink: React.FC<ConvoLinkProps> = ({
  isActiveConvo,
  title,
  onRename,
  isSmallScreen,
  localize,
  children,
}) => {
  return (
    <div
      className={cn(
        'flex grow items-center gap-2 overflow-hidden rounded-[0.72rem] px-2.5 py-1',
        isActiveConvo ? '[background:var(--sidebar-item-active)]' : '',
      )}
      title={title ?? undefined}
      aria-current={isActiveConvo ? 'page' : undefined}
      style={{ width: '100%' }}
    >
      {children}
      <div
        className={cn(
          'relative flex-1 grow overflow-hidden whitespace-nowrap text-sm text-text-primary',
          isActiveConvo ? 'font-medium' : 'font-normal',
        )}
        style={{ textOverflow: 'clip' }}
        onDoubleClick={(e) => {
          if (isSmallScreen) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onRename();
        }}
        aria-label={title || localize('com_ui_untitled')}
      >
        {title || localize('com_ui_untitled')}
      </div>
      <div
        className={cn(
          'absolute bottom-0 right-0 top-0 w-24 rounded-r-lg bg-gradient-to-l',
          isActiveConvo
            ? 'from-[var(--sidebar-item-active)]'
            : 'from-[var(--sidebar-shell-bg-alt)] from-0% to-transparent group-hover:from-[var(--sidebar-item-hover)] group-hover:from-40%',
        )}
        aria-hidden="true"
      />
    </div>
  );
};

export default ConvoLink;
