import React from 'react';
import { ToggleContext } from './ToggleContext';
import { cn } from '~/utils';

const HoverToggle = ({
  children,
  isActiveConvo,
  isPopoverActive,
  setIsPopoverActive,
  className = 'absolute bottom-0 right-0 top-0',
  onClick,
}: {
  children: React.ReactNode;
  isActiveConvo: boolean;
  isPopoverActive: boolean;
  setIsPopoverActive: (isActive: boolean) => void;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const setPopoverActive = (value: boolean) => setIsPopoverActive(value);
  return (
    <ToggleContext.Provider value={{ isPopoverActive, setPopoverActive }}>
      <div
        onClick={onClick}
        className={cn(
          'peer items-center gap-1.5 rounded-r-xl pl-2 pr-2 text-text-primary backdrop-blur-sm transition-all duration-200',
          isPopoverActive || isActiveConvo ? 'flex' : 'hidden group-hover:flex',
          isActiveConvo
            ? '[background:linear-gradient(to_left,var(--sidebar-item-active)_66%,transparent)]'
            : 'z-50 [background:linear-gradient(to_left,var(--sidebar-item-hover)_62%,transparent)]',
          isPopoverActive && !isActiveConvo
            ? '[background:linear-gradient(to_left,var(--sidebar-item-hover)_66%,transparent)]'
            : '',
          className,
        )}
      >
        {children}
      </div>
    </ToggleContext.Provider>
  );
};

export default HoverToggle;
